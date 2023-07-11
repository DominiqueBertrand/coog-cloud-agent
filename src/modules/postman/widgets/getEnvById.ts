import * as fs from 'fs';
import * as path from 'path';

export function getEnvById(id: string) {
  const folderP = 'src/modules/postman/env/';
  const folders = fs.readdirSync(folderP);
  let folderJsonContent: Array<any> = [];

  // Search all directories in 'src/postman/env/'
  folders.forEach(folder => {
    if (fs.lstatSync(folderP + folder).isDirectory()) {
      folderJsonContent = readFolderJSONContent(folderP + folder);
    }
  });

  function readFolderJSONContent(folderPath: string) {
    const files = fs.readdirSync(folderPath);
    const jsonContent: any[] = [];

    const jsonFiles = files.filter(file => path.extname(file) === '.json');
    // Find all JSON files in folder
    jsonFiles.forEach(file => {
      const filePath = path.join(folderPath, file);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const jsonData = JSON.parse(fileContent);

      if (jsonData.id === id) {
        // get JSON with correct id
        jsonContent.push(jsonData);
      }
    });
    return jsonContent;
  }

  return folderJsonContent;
}
