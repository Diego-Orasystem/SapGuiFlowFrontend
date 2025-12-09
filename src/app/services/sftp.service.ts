import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
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
  private apiUrl = '/api/sftp'; // Ajustar según la configuración del backend

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
   */
  listPackages(): Observable<SftpFileListResponse> {
    const headers = this.getHeaders();
    return this.http.get<SftpFileListResponse>(`${this.apiUrl}/list-packages`, { headers });
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
   */
  savePackageToSftp(packageName: string, packageData: any, overwrite: boolean = false): Observable<SavePackageToSftpResponse> {
    const headers = this.getHeaders();
    const request: SavePackageToSftpRequest = {
      packageName,
      packageData,
      overwrite
    };
    return this.http.post<SavePackageToSftpResponse>(
      `${this.apiUrl}/save-package`,
      request,
      { headers }
    );
  }

  /**
   * Verifica si un paquete existe en el servidor SFTP
   */
  checkPackageExists(packageName: string): Observable<{ exists: boolean; filePath?: string }> {
    const headers = this.getHeaders();
    return this.http.post<{ exists: boolean; filePath?: string }>(
      `${this.apiUrl}/check-package-exists`,
      { packageName },
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
   * Obtiene la API Key (puede venir de un servicio de configuración o localStorage)
   */
  private getApiKey(): string | null {
    // TODO: Implementar obtención de API Key desde configuración o localStorage
    return localStorage.getItem('apiKey') || null;
  }
}

