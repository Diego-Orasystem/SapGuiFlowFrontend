import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, from } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { FlowFile } from '../models/flow-file.model';
import * as FileSaver from 'file-saver';
import * as JSZip from 'jszip';

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  modified: Date;
  content: string;
}

@Injectable({
  providedIn: 'root'
})
export class FileService {
  private apiUrl = 'http://10.90.0.24:3000/api/flow';
  
  private inputFileSubject = new BehaviorSubject<File | null>(null);
  private inputFilesSubject = new BehaviorSubject<FileInfo[]>([]);
  private outputFilesSubject = new BehaviorSubject<FileInfo[]>([]);
  private selectedFileSubject = new BehaviorSubject<FileInfo | null>(null);
  private controlTypesSubject = new BehaviorSubject<string[]>([]);

  constructor(private http: HttpClient) { }

  // Getters para observables
  getInputFile(): Observable<File | null> {
    return this.inputFileSubject.asObservable();
  }

  getInputFiles(): Observable<FileInfo[]> {
    return this.inputFilesSubject.asObservable();
  }

  getOutputFiles(): Observable<FileInfo[]> {
    return this.outputFilesSubject.asObservable();
  }

  getSelectedFile(): Observable<FileInfo | null> {
    return this.selectedFileSubject.asObservable();
  }

  // Setters
  setInputFile(file: File): void {
    this.inputFileSubject.next(file);
  }

  setSelectedFile(file: FileInfo | null): void {
    this.selectedFileSubject.next(file);
  }

  // Datos de prueba precargados
  loadDemoData(): Observable<FileInfo[]> {
    const demoFiles: FileInfo[] = [
      {
        name: 'mainFlow.json',
        path: '/demo/mainFlow.json',
        size: 15360,
        modified: new Date('2025-05-30'),
        content: JSON.stringify({
          "$meta": {
            "version": "2.2",
            "tx": "mainFlow completo con todos los subflujos",
            "created": "2025-05-30"
          },
          "prefixes": {
            "usr": "/app/con[0]/ses[0]/wnd[1]/usr/",
            "popup": "/app/con[0]/ses[0]/wnd[1]/usr/"
          },
          "$mainFlow": {
            "steps": {
              "runCji3": {
                "action": "callSubflow",
                "subflow": "cji3",
                "next": "runCn41n"
              },
              "runCn41n": {
                "action": "callSubflow",
                "subflow": "cn41n",
                "next": "runMb51"
              },
              "runMb51": {
                "action": "callSubflow",
                "subflow": "mb51",
                "next": "runMb52"
              },
              "runMb52": {
                "action": "callSubflow",
                "subflow": "mb52",
                "next": "runMe2l"
              },
              "runMe2l": {
                "action": "callSubflow",
                "subflow": "me2l",
                "next": "runMe5a"
              },
              "runMe5a": {
                "action": "callSubflow",
                "subflow": "me5a",
                "next": "end"
              },
              "end": {
                "action": "exit"
              }
            }
          }
        }, null, 2)
      },
      {
        name: 'mb51.json',
        path: '/demo/mb51.json',
        size: 4700,
        modified: new Date('2025-05-30'),
        content: JSON.stringify({
          "$meta": {
            "version": "2.2",
            "tx": "Visualización de documentos de material",
            "created": "2025-05-30"
          },
          "$mb51": {
            "steps": {
              "init": {
                "action": "start",
                "next": "enterTransactionCode"
              },
              "enterTransactionCode": {
                "action": "setValue",
                "element": "main.control.okcd",
                "value": "mb51",
                "next": "execute"
              },
              "execute": {
                "action": "click",
                "element": "main.popup.accept",
                "next": "setInitialFilters"
              },
              "setInitialFilters": {
                "action": "setValue",
                "element": "main.filter.budatlow",
                "value": "{{parameters.fechaInicio}}",
                "next": "setFechaFin"
              },
              "setFechaFin": {
                "action": "setValue",
                "element": "main.filter.budathigh",
                "value": "{{parameters.fechaFin}}",
                "next": "setCentro"
              },
              "setCentro": {
                "action": "setValue",
                "element": "main.filter.werkslow",
                "value": "{{parameters.centro}}",
                "next": "setAlmacen"
              },
              "setAlmacen": {
                "action": "setValue",
                "element": "main.filter.lgortlow",
                "value": "{{parameters.almacen}}",
                "next": "executeReport"
              },
              "executeReport": {
                "action": "click",
                "element": "main.button.btn8",
                "next": "end"
              },
              "end": {
                "action": "exit"
              }
            }
          }
        }, null, 2)
      },
      {
        name: 'me5a.json',
        path: '/demo/me5a.json',
        size: 8400,
        modified: new Date('2025-05-30'),
        content: JSON.stringify({
          "$meta": {
            "version": "2.2",
            "tx": "Solicitudes de pedido",
            "created": "2025-05-30"
          },
          "$me5a": {
            "steps": {
              "init": {
                "action": "start",
                "next": "enterTransactionCode"
              },
              "enterTransactionCode": {
                "action": "setValue",
                "element": "main.control.okcd",
                "value": "me5a",
                "next": "execute"
              },
              "execute": {
                "action": "click",
                "element": "main.popup.accept",
                "next": "setInitialFilters"
              },
              "setInitialFilters": {
                "action": "setValue",
                "element": "me5a.filter.ba_ekgrphigh",
                "value": "{{parameters.grupo}}",
                "next": "setVariant"
              },
              "setVariant": {
                "action": "setValue",
                "element": "me5a.filter.p_lstub",
                "value": "{{parameters.variante}}",
                "next": "executeReport"
              },
              "executeReport": {
                "action": "click",
                "element": "main.button.btn8",
                "next": "end"
              },
              "end": {
                "action": "exit"
              }
            }
          }
        }, null, 2)
      }
    ];

    // Actualizar los BehaviorSubject
    this.inputFilesSubject.next(demoFiles);
    if (demoFiles.length > 0) {
      this.selectedFileSubject.next(demoFiles[0]);
    }

    // Crear también algunos archivos procesados de demostración
    const processedDemoFiles: FileInfo[] = [
      {
        name: 'mainFlow_processed.json',
        path: '/demo/processed/mainFlow_processed.json',
        size: 16800,
        modified: new Date('2025-05-30'),
        content: JSON.stringify({
          "$meta": {
            "version": "2.3",
            "tx": "mainFlow completo con todos los subflujos (Procesado)",
            "created": "2025-05-30",
            "processed": true
          },
          "prefixes": {
            "usr": "/app/con[0]/ses[0]/wnd[1]/usr/",
            "popup": "/app/con[0]/ses[0]/wnd[1]/usr/"
          },
          "$mainFlow": {
            "steps": {
              "runCji3": {
                "action": "callSubflow",
                "subflow": "cji3",
                "next": "runCn41n"
              },
              "runCn41n": {
                "action": "callSubflow",
                "subflow": "cn41n",
                "next": "runMb51"
              },
              "runMb51": {
                "action": "callSubflow",
                "subflow": "mb51",
                "next": "runMb52"
              },
              "runMb52": {
                "action": "callSubflow",
                "subflow": "mb52",
                "next": "runMe2l"
              },
              "runMe2l": {
                "action": "callSubflow",
                "subflow": "me2l",
                "next": "runMe5a"
              },
              "runMe5a": {
                "action": "callSubflow",
                "subflow": "me5a",
                "next": "end"
              },
              "end": {
                "action": "exit"
              }
            }
          }
        }, null, 2)
      },
      {
        name: 'mb51_processed.json',
        path: '/demo/processed/mb51_processed.json',
        size: 5120,
        modified: new Date('2025-05-30'),
        content: JSON.stringify({
          "$meta": {
            "version": "2.3",
            "tx": "Visualización de documentos de material (Procesado)",
            "created": "2025-05-30",
            "processed": true
          },
          "$mb51": {
            "steps": {
              "init": {
                "action": "start",
                "next": "enterTransactionCode"
              },
              "enterTransactionCode": {
                "action": "setValue",
                "element": "main.control.okcd",
                "value": "mb51",
                "next": "execute"
              },
              "execute": {
                "action": "click",
                "element": "main.popup.accept",
                "next": "setInitialFilters"
              },
              "setInitialFilters": {
                "action": "setValue",
                "element": "main.filter.budatlow",
                "value": "{{parameters.fechaInicio}}",
                "next": "setFechaFin"
              },
              "setFechaFin": {
                "action": "setValue",
                "element": "main.filter.budathigh",
                "value": "{{parameters.fechaFin}}",
                "next": "setCentro"
              },
              "setCentro": {
                "action": "setValue",
                "element": "main.filter.werkslow",
                "value": "{{parameters.centro}}",
                "next": "setAlmacen"
              },
              "setAlmacen": {
                "action": "setValue",
                "element": "main.filter.lgortlow",
                "value": "{{parameters.almacen}}",
                "next": "executeReport"
              },
              "executeReport": {
                "action": "click",
                "element": "main.button.btn8",
                "next": "end"
              },
              "end": {
                "action": "exit"
              }
            }
          }
        }, null, 2)
      }
    ];

    this.outputFilesSubject.next(processedDemoFiles);
    
    return of(demoFiles);
  }

  // Métodos de API
  uploadZipFile(file: File): Observable<FileInfo[]> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<{success: boolean, message: string, inputFiles: FileInfo[], outputFiles: FileInfo[]}>(`${this.apiUrl}/upload`, formData).pipe(
      map(response => {
        this.inputFilesSubject.next(response.inputFiles);
        this.outputFilesSubject.next(response.outputFiles);
        if (response.inputFiles.length > 0) {
          this.selectedFileSubject.next(response.inputFiles[0]);
        }
        return response.inputFiles;
      }),
      catchError(error => {
        console.error('Error processing ZIP file:', error);
        return of([]);
      })
    );
  }
  
  // Método para subir un archivo ZIP
  uploadZipFile2(file: File): Observable<FileInfo[]> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<{success: boolean, message: string, files: FileInfo[]}>(`${this.apiUrl}/upload`, formData).pipe(
      map(response => response.files),
      tap(files => {
        this.inputFilesSubject.next(files);
        if (files.length > 0) {
          this.selectedFileSubject.next(files[0]);
        }
      })
    );
  }

  processFiles(files: FileInfo[]): Observable<FileInfo[]> {
    return this.http.post<FileInfo[]>(`${this.apiUrl}/process`, files).pipe(
      tap(processedFiles => {
        this.outputFilesSubject.next(processedFiles);
        if (processedFiles.length > 0) {
          this.selectedFileSubject.next(processedFiles[0]);
        }
      })
    );
  }

  updateFile(file: FileInfo): Observable<FileInfo> {
    return this.http.put<FileInfo>(`${this.apiUrl}/update`, file).pipe(
      tap(updatedFile => {
        // Actualizar en lista de entrada
        const inputFiles = this.inputFilesSubject.value;
        const inputIndex = inputFiles.findIndex(f => f.name === updatedFile.name);
        if (inputIndex > -1) {
          inputFiles[inputIndex] = updatedFile;
          this.inputFilesSubject.next([...inputFiles]);
        }

        // Actualizar en lista de salida
        const outputFiles = this.outputFilesSubject.value;
        const outputIndex = outputFiles.findIndex(f => f.name === updatedFile.name);
        if (outputIndex > -1) {
          outputFiles[outputIndex] = updatedFile;
          this.outputFilesSubject.next([...outputFiles]);
        }

        // Actualizar archivo seleccionado
        if (this.selectedFileSubject.value?.name === updatedFile.name) {
          this.selectedFileSubject.next(updatedFile);
        }
      })
    );
  }

  // Método para exportar archivos directamente desde el frontend
  exportFiles(files: FileInfo[]): Observable<Blob> {
    // Crear un nuevo archivo ZIP
    const zip = new JSZip();
    
    // Añadir cada archivo al ZIP
    files.forEach(file => {
      if (file.content) {
        // Usar el nombre del archivo como clave
        zip.file(file.name, file.content);
      }
    });
    
    // Generar el archivo ZIP y convertir la Promise<Blob> a Observable<Blob>
    return from(zip.generateAsync({ type: 'blob' })).pipe(
      catchError(error => {
        console.error('Error al generar el archivo ZIP:', error);
        throw error;
      })
    );
  }

  // Método para verificar la integridad de los flujos
  verifyFlowIntegrity(files: FileInfo[]): { valid: boolean, errors: string[] } {
    const result = { valid: true, errors: [] as string[] };
    
    files.forEach(file => {
      if (!file.content) {
        result.valid = false;
        result.errors.push(`El archivo ${file.name} no tiene contenido.`);
        return;
      }
      
      try {
        const content = JSON.parse(file.content);
        
        // Verificar estructura básica
        if (!content.$meta) {
          result.valid = false;
          result.errors.push(`El archivo ${file.name} no tiene metadatos ($meta).`);
        }
        
        // Verificar que tiene al menos un flujo
        const flowKeys = Object.keys(content).filter(key => key.startsWith('$') && key !== '$meta');
        if (flowKeys.length === 0) {
          result.valid = false;
          result.errors.push(`El archivo ${file.name} no contiene definiciones de flujo.`);
        }
        
        // Verificar cada flujo
        flowKeys.forEach(flowKey => {
          const flow = content[flowKey];
          
          if (!flow.steps || Object.keys(flow.steps).length === 0) {
            result.valid = false;
            result.errors.push(`El flujo ${flowKey} en ${file.name} no tiene pasos definidos.`);
          }
        });
      } catch (error) {
        result.valid = false;
        result.errors.push(`Error al parsear el archivo ${file.name}: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      }
    });
    
    return result;
  }

  // Método para exportar un solo archivo
  exportSingleFile(file: FileInfo): void {
    if (!file.content) {
      console.error('El archivo no tiene contenido');
      return;
    }
    
    const blob = new Blob([file.content], { type: 'application/json' });
    FileSaver.saveAs(blob, file.name);
  }

  downloadZip(blob: Blob, filename = 'sap-gui-flow.zip'): void {
    FileSaver.saveAs(blob, filename);
  }

  // Método para obtener tipos de controles
  getControlTypes(): Observable<string[]> {
    return this.http.get<any>(`${this.apiUrl}/control-types`).pipe(
      map(response => response.controlTypes || []),
      tap(controlTypes => this.controlTypesSubject.next(controlTypes))
    );
  }

  // Observable para tipos de controles
  getControlTypesObservable(): Observable<string[]> {
    return this.controlTypesSubject.asObservable();
  }
} 