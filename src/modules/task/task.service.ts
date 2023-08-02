import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository, wrap, EntityManager, QueryOrder } from '@mikro-orm/core';
import { PmCollection, PmEnvironment, PmSchedule, Task } from '@src/entities';
import { CreateOrUpdateElementDto, FindAllElementsQueryDto, PoolRunWorkerDto } from './dto';
import Piscina from 'piscina';
import { resolvePromisesSeq } from './middleware/resolvePromiseSeq';
import { UpdateReportDto } from './dto/update-report';
import { CronJob } from 'cron';
import { sanitizeTask } from './task.utils';
import { ITask } from './task.type';

@Injectable()
export class TaskService {
  static pool: Piscina;
  constructor(
    @InjectRepository(Task) private readonly taskRepository: EntityRepository<Task>,
    @InjectRepository(PmCollection) private readonly pmCollectionRepository: EntityRepository<PmCollection>,
    @InjectRepository(PmEnvironment) private readonly pmEnvironmentRepository: EntityRepository<PmEnvironment>,
    @InjectRepository(PmSchedule) private readonly pmScheduleRepository: EntityRepository<PmSchedule>,
    private readonly em: EntityManager,
  ) {
    TaskService.pool = TaskService.pool ? TaskService.pool : TaskService.poolInstance();
  }
  public static poolInstance(): Piscina {
    this.pool = new Piscina({
      filename: './dist/modules/task/worker/worker.js',
      maxThreads: 4,
    });
    return this.pool;
  }

  async findAll({ limit, offset, orderBy: orderbyKey }: FindAllElementsQueryDto): Promise<Task[]> {
    let orderBy: any;

    switch (orderbyKey) {
      case 'updatedAt': {
        orderBy = { updatedAt: QueryOrder.DESC };
        break;
      }
      case 'createdAt': {
        orderBy = { createdAt: QueryOrder.DESC };
        break;
      }
      case 'id': {
        orderBy = { id: QueryOrder.DESC };
        break;
      }

      default: {
        orderBy = { updatedAt: QueryOrder.DESC };
        break;
      }
    }
    return this.taskRepository.findAll({
      //   populate: ['report', 'report'],
      orderBy,
      limit: limit ?? 20,
      offset: offset ?? 0,
      fields: [
        'id',
        'createdAt',
        'updatedAt',
        'status',
        'type',
        'testStatus',
        'collection.id',
        'collection.name',
        'environment.id',
        'environment.name',
        'reports.id',
        'schedule.id',
      ],
    });
  }

  async findOne(id: string): Promise<Task | null> {
    const report: Task | null = await this.taskRepository.findOne(id, {
      fields: [
        'id',
        'createdAt',
        'updatedAt',
        'status',
        'type',
        'testStatus',
        'collection.id',
        'collection.name',
        'environment.id',
        'environment.name',
        'reports.id',
        'schedule.id',
      ],
    });
    return report;
  }

  async create({ collection, environment, type }: Partial<CreateOrUpdateElementDto>): Promise<ITask> {
    try {
      const pmCollection: PmCollection | null = await this.pmCollectionRepository.findOne({ id: collection?.id });
      const pmEnvironment: PmEnvironment | null = await this.pmEnvironmentRepository.findOne({ id: environment?.id });
      if (!pmCollection) {
        throw new HttpException('Collecion not found', HttpStatus.NOT_FOUND);
      }
      if (!pmEnvironment) {
        throw new HttpException('Environment not found', HttpStatus.NOT_FOUND);
      }
      const taskRepository = this.em.getRepository(Task);

      const task = taskRepository.create(new Task(pmCollection, pmEnvironment, type));
      pmCollection.tasks.add(task);
      pmEnvironment.tasks.add(task);
      await this.em.flush();

      return sanitizeTask(task);
    } catch (error: any) {
      console.error(error);
      console.table(error);
      throw new HttpException(error.name, HttpStatus.BAD_REQUEST);
    }
  }

  async update(
    id: string,
    { collection, environment, status, testStatus }: Partial<CreateOrUpdateElementDto>,
  ): Promise<ITask> {
    try {
      const task: Task | null = await this.taskRepository.findOne(id);
      if (!task) {
        throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
      }
      const pmCollection = this.pmCollectionRepository.findOne({ id: collection?.id });
      const pmEnvironment = this.pmEnvironmentRepository.findOne({ id: environment?.id });
      if (!pmCollection && !pmEnvironment) {
        throw new HttpException('Collecion or Environment not found', HttpStatus.NOT_FOUND);
      }
      if (status && testStatus) {
        wrap(task).assign({ status: status, testStatus: testStatus });
      }
      wrap(task).assign({ collection, environment });
      await this.em.flush();

      return sanitizeTask(task);
    } catch (error: any) {
      console.table(error);
      throw new HttpException(error.name, HttpStatus.BAD_REQUEST);
    }
  }

  async updateReport(id: string, { status, testStatus, report }: Partial<UpdateReportDto>): Promise<ITask> {
    try {
      const task: Task | null = await this.taskRepository.findOne(id);
      if (!task) {
        throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
      }
      if (status && testStatus) wrap(task).assign({ status: status, testStatus: testStatus });
      if (report) wrap(task).assign({ reports: { report } });
      await this.em.flush();

      return sanitizeTask(task);
    } catch (error: any) {
      console.table(error);
      throw new HttpException(error.name, HttpStatus.BAD_REQUEST);
    }
  }

  async delete(id: string) {
    try {
      // using reference is enough, no need for a fully initialized entity
      const task = await this.taskRepository.findOne(id);

      if (!task) {
        throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
      } else {
        await this.em.removeAndFlush(task);
      }
    } catch (error: any) {
      console.table(error);
      throw new HttpException(error.name, HttpStatus.NOT_FOUND);
    }
  }

  async run(id: string): Promise<ITask> {
    try {
      // using reference is enough, no need for a fully initialized entity
      const task: Task | null = await this.taskRepository.findOne(id, {
        fields: ['id', 'collection', 'environment'],
        populate: ['collection', 'environment'],
      });
      if (!task) {
        throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
      }
      const pmCollection: PmCollection | null = await this.pmCollectionRepository.findOne(
        { id: task.collection?.id },
        { populate: ['collection'] },
      );
      const pmEnvironment: PmEnvironment | null = await this.pmEnvironmentRepository.findOne({
        id: task.environment?.id,
      });
      if (!pmCollection) {
        throw new HttpException('Collection not found', HttpStatus.NOT_FOUND);
      }
      if (!pmEnvironment) {
        throw new HttpException('Environment not found', HttpStatus.NOT_FOUND);
      }

      await TaskService.pool.run(new PoolRunWorkerDto(task.id, pmEnvironment, pmCollection));

      return sanitizeTask(task);
    } catch (error: any) {
      console.table(error);
      throw new HttpException(error.name, HttpStatus.NOT_FOUND);
    }
  }

  async runBatch(tasksIds: Array<string>): Promise<Array<object>> {
    try {
      const tasksData: Array<object> = [];
      await resolvePromisesSeq(
        tasksIds.map(async taskId => {
          console.log(taskId);
          const taskLoaded = await this.taskRepository.findOne(
            { id: taskId },
            // { populate: ['collection', 'environment'] },
          );
          const pmCollection: PmCollection | null = await this.pmCollectionRepository.findOne(
            { id: taskLoaded?.collection?.id },
            { populate: ['collection'] },
          );
          const pmEnvironment: PmEnvironment | null = await this.pmEnvironmentRepository.findOne({
            id: taskLoaded?.environment?.id,
          });
          if (!pmCollection) {
            throw new HttpException('Collecion not found', HttpStatus.NOT_FOUND);
          }
          if (!pmEnvironment) {
            throw new HttpException('Environment not found', HttpStatus.NOT_FOUND);
          }
          if (!taskLoaded) {
            throw new HttpException('Task not found : ' + { taskId }, HttpStatus.NOT_FOUND);
          }
          tasksData.push({ id: taskId, collection: pmCollection.collection, environment: pmEnvironment.environment });
        }),
      );
      (async () => {
        await Promise.all([
          tasksData.map(async task => {
            await TaskService.pool.run(task);
          }),
        ]);
      })();
      return tasksData;
    } catch (error: any) {
      console.table(error);
      throw new HttpException(error.name, HttpStatus.NOT_FOUND);
    }
  }
  async runSchedule(id: string): Promise<void> {
    try {
      // using reference is enough, no need for a fully initialized entity
      const scheduleData = await this.pmScheduleRepository.findOne(id);

      if (!scheduleData) {
        throw new HttpException('Schedule not found', HttpStatus.NOT_FOUND);
      } else {
        const job = new CronJob(scheduleData.schedule.cron, () => {
          console.log('job');
        });
        console.log(job);
        // this.schedulerRegistry.addCronJob(schedule.id, job);
      }
    } catch (error: any) {
      console.table(error);
      throw new HttpException(error.name, HttpStatus.NOT_FOUND);
    }
  }
}
