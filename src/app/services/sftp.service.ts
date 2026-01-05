import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SftpFile {
  name: string;
  path: string;
  size: number;
  modifiedDate: string;
  isDirectory: boolean;
}

export interface SftpFileListResponse {
  status: boolean;
  message: string;
  files: SftpFile[];
}

export interface SftpFileContentResponse {
  status: boolean;
  message: string;
  content: string;
  fileName: string;
}

export interface SavePackageToSftpRequest {
  packageName: string;
  packageData: any;
  overwrite?: boolean;
  targetDirectory?: string; // Directorio destino para guardar el paquete
}

export interface SavePackageToSftpResponse {
  status: boolean;
  message: string;
  filePath?: string;
  fileName?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SftpService {
  private apiUrl = 'http://localhost:3000/api/sftp'; // Ajustar según la configuración del backend

  constructor(private http: HttpClient) { }

  /**
   * Lista los archivos JSON del directorio SFTP (para formularios)
   */
  listJsonFiles(): Observable<SftpFileListResponse> {
    const headers = this.getHeaders();
    return this.http.get<SftpFileListResponse>(`${this.apiUrl}/list-json`, { headers });
  }

  /**
   * Lista los paquetes guardados en el directorio SFTP
   * @param directory Directorio desde donde listar los paquetes (por defecto sap-queries)
   */
  listPackages(directory?: string): Observable<SftpFileListResponse> {
    const headers = this.getHeaders();
    let params = new HttpParams();
    if (directory) {
      params = params.set('directory', directory);
    }
    return this.http.get<SftpFileListResponse>(`${this.apiUrl}/list-packages`, { 
      headers,
      params
    });
  }

  /**
   * Lista los flujos disponibles en el directorio SFTP
   */
  listFlows(): Observable<SftpFileListResponse> {
    const headers = this.getHeaders();
    return this.http.get<SftpFileListResponse>(`${this.apiUrl}/list-flows`, { headers });
  }

  /**
   * Obtiene el contenido de un archivo JSON específico
   */
  getJsonFileContent(filePath: string): Observable<SftpFileContentResponse> {
    const headers = this.getHeaders();
    return this.http.post<SftpFileContentResponse>(
      `${this.apiUrl}/get-file-content`,
      { filePath },
      { headers }
    );
  }

  /**
   * Guarda un paquete completo en el servidor SFTP
   * @param packageName Nombre del paquete
   * @param packageData Datos del paquete
   * @param overwrite Si sobrescribir el archivo existente
   * @param targetDirectory Directorio destino (por defecto sap-queries)
   */
  savePackageToSftp(
    packageName: string, 
    packageData: any, 
    overwrite: boolean = false,
    targetDirectory: string = 'sap-queries'
  ): Observable<SavePackageToSftpResponse> {
    const headers = this.getHeaders();
    const request: SavePackageToSftpRequest = {
      packageName,
      packageData,
      overwrite,
      targetDirectory
    };
    return this.http.post<SavePackageToSftpResponse>(
      `${this.apiUrl}/save-package`,
      request,
      { headers }
    );
  }

  /**
   * Verifica si un paquete existe en el servidor SFTP
   * @param packageName Nombre del paquete
   * @param directory Directorio donde buscar (por defecto sap-queries)
   */
  checkPackageExists(
    packageName: string, 
    directory: string = 'sap-queries'
  ): Observable<{ exists: boolean; filePath?: string }> {
    const headers = this.getHeaders();
    return this.http.post<{ exists: boolean; filePath?: string }>(
      `${this.apiUrl}/check-package-exists`,
      { packageName, directory },
      { headers }
    );
  }

  /**
   * Lista los targets disponibles en el directorio SFTP
   */
  listTargets(): Observable<SftpFileListResponse> {
    const headers = this.getHeaders();
    return this.http.get<SftpFileListResponse>(`${this.apiUrl}/list-targets`, { headers });
  }

  /**
   * Obtiene el contenido de un target específico desde SFTP
   */
  getTargetContent(targetPath: string): Observable<SftpFileContentResponse> {
    const headers = this.getHeaders();
    return this.http.post<SftpFileContentResponse>(
      `${this.apiUrl}/get-file-content`,
      { filePath: targetPath },
      { headers }
    );
  }

  /**
   * Obtiene los controles disponibles de un targetContext específico
   */
  getTargetContextControls(
    targetContextKey: string, 
    targetContext?: any,
    flowData?: any
  ): Observable<{
    status: boolean;
    message: string;
    controls: Array<{
      name: string;
      friendlyName: string;
      controlType: string;
      path: string;
      isManipulable: boolean;
    }>;
  }> {
    const headers = this.getHeaders();
    const requestBody: any = { targetContextKey };
    
    if (targetContext) {
      requestBody.targetContext = targetContext;
    }
    
    if (flowData) {
      requestBody.flowData = flowData;
    }
    
    return this.http.post<{
      status: boolean;
      message: string;
      controls: Array<{
        name: string;
        friendlyName: string;
        controlType: string;
        path: string;
        isManipulable: boolean;
      }>;
    }>(
      `${this.apiUrl}/get-target-context-controls`,
      requestBody,
      { headers }
    );
  }

  /**
   * Elimina un archivo del servidor SFTP
   * @param filePath Ruta completa del archivo a eliminar
   * @param directory Directorio donde está el archivo
   */
  deleteFile(filePath: string, directory?: string): Observable<{ status: boolean; message: string }> {
    const headers = this.getHeaders();
    return this.http.post<{ status: boolean; message: string }>(
      `${this.apiUrl}/delete-file`,
      { filePath, directory },
      { headers }
    );
  }

  /**
   * Obtiene los headers con la API Key
   */
  private getHeaders(): HttpHeaders {
    const apiKey = this.getApiKey();
    return new HttpHeaders({
      'X-API-KEY': apiKey || '',
      'Content-Type': 'application/json'
    });
  }

  /**
   * Lista el contenido de un directorio específico
   * @param path Ruta del directorio (vacío para root)
   */
  listDirectory(path: string = ''): Observable<SftpFileListResponse> {
    const headers = this.getHeaders();
    return this.http.post<SftpFileListResponse>(
      `${this.apiUrl}/list-directory`,
      { path },
      { headers }
    );
  }

  /**
   * Obtiene el contenido de un archivo
   * @param filePath Ruta del archivo
   */
  getFileContent(filePath: string): Observable<SftpFileContentResponse> {
    const headers = this.getHeaders();
    return this.http.post<SftpFileContentResponse>(
      `${this.apiUrl}/get-file-content`,
      { filePath },
      { headers }
    );
  }

  /**
   * Crea un nuevo archivo
   * @param directory Directorio donde crear el archivo
   * @param fileName Nombre del archivo
   * @param content Contenido del archivo
   */
  createFile(directory: string, fileName: string, content: string): Observable<{ status: boolean; message: string }> {
    const headers = this.getHeaders();
    return this.http.post<{ status: boolean; message: string }>(
      `${this.apiUrl}/create-file`,
      { directory, fileName, content },
      { headers }
    );
  }

  /**
   * Actualiza el contenido de un archivo
   * @param filePath Ruta del archivo
   * @param content Nuevo contenido
   */
  updateFile(filePath: string, content: string): Observable<{ status: boolean; message: string }> {
    const headers = this.getHeaders();
    return this.http.post<{ status: boolean; message: string }>(
      `${this.apiUrl}/update-file`,
      { filePath, content },
      { headers }
    );
  }

  /**
   * Crea un nuevo directorio
   * @param parentDirectory Directorio padre
   * @param directoryName Nombre del nuevo directorio
   */
  createDirectory(parentDirectory: string, directoryName: string): Observable<{ status: boolean; message: string }> {
    const headers = this.getHeaders();
    return this.http.post<{ status: boolean; message: string }>(
      `${this.apiUrl}/create-directory`,
      { parentDirectory, directoryName },
      { headers }
    );
  }

  /**
   * Elimina un directorio
   * @param directoryPath Ruta del directorio a eliminar
   */
  deleteDirectory(directoryPath: string): Observable<{ status: boolean; message: string }> {
    const headers = this.getHeaders();
    return this.http.post<{ status: boolean; message: string }>(
      `${this.apiUrl}/delete-directory`,
      { directoryPath },
      { headers }
    );
  }

  /**
   * Descarga un archivo del servidor SFTP
   * @param filePath Ruta del archivo a descargar
   * @returns Observable con el blob del archivo
   */
  downloadFile(filePath: string): Observable<Blob> {
    const headers = this.getHeaders();
    return this.http.post(
      `${this.apiUrl}/download-file`,
      { filePath },
      { 
        headers,
        responseType: 'blob'
      }
    );
  }

  /**
   * Obtiene la API Key (puede venir de un servicio de configuración o localStorage)
   */
  private getApiKey(): string | null {
    // TODO: Implementar obtención de API Key desde configuración o localStorage
    return localStorage.getItem('apiKey') || null;
  }
}

