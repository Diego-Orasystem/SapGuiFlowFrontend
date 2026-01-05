import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SftpService, SftpFile } from '../../services/sftp.service';
import { SftpValidatorService, SftpOperationLog, FileValidationResult } from '../../services/sftp-validator.service';

@Component({
  selector: 'app-sftp-explorer',
  templateUrl: './sftp-explorer.component.html',
  styleUrls: ['./sftp-explorer.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class SftpExplorerComponent implements OnInit {
  currentPath: string = '';
  files: SftpFile[] = [];
  loading = false;
  errorMessage: string | null = null;
  
  // Para crear nuevo archivo/carpeta
  showCreateModal = false;
  newItemName: string = '';
  newItemType: 'file' | 'directory' = 'file';
  newItemContent: string = '';
  
  // Para editar archivo
  showEditModal = false;
  editingFile: SftpFile | null = null;
  editContent: string = '';
  
  // Para eliminar
  showDeleteModal = false;
  deletingItem: SftpFile | null = null;
  
  // Breadcrumb
  pathHistory: string[] = [];
  pathSegments: string[] = [];
  
  // Barra de dirección editable
  editablePath: string = '';
  isEditingPath: boolean = false;

  // Panel de información y logs
  showInfoPanel: boolean = false;
  showLogsPanel: boolean = false;
  fileDetails: any = null;
  filePreview: string | null = null;
  validationResult: FileValidationResult | null = null;
  operationLogs: SftpOperationLog[] = [];
  showPreview: boolean = false;

  constructor(
    private sftpService: SftpService,
    private sftpValidator: SftpValidatorService
  ) {}

  ngOnInit(): void {
    this.navigateToPath('');
    this.editablePath = '';
  }

  /**
   * Activa el modo de edición de la barra de dirección
   */
  startEditingPath(): void {
    this.isEditingPath = true;
    this.editablePath = this.currentPath;
    // Enfocar el input después de un pequeño delay para que Angular lo renderice
    setTimeout(() => {
      const input = document.querySelector('.path-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  /**
   * Navega a la ruta escrita en la barra de dirección (al presionar Enter)
   */
  navigateFromEditablePath(): void {
    if (this.editablePath !== this.currentPath) {
      this.navigateToPath(this.editablePath);
    } else {
      this.isEditingPath = false;
    }
  }

  /**
   * Cancela la edición de la barra de dirección (al presionar Escape)
   */
  cancelEditingPath(): void {
    this.editablePath = this.currentPath;
    this.isEditingPath = false;
  }

  /**
   * Maneja el evento de teclado en la barra de dirección
   */
  onPathKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.navigateFromEditablePath();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEditingPath();
    }
  }

  /**
   * Obtiene los segmentos del path actual para el breadcrumb
   */
  getPathSegments(): string[] {
    return this.currentPath.split('/').filter(s => s);
  }

  /**
   * Obtiene el path hasta un segmento específico
   */
  getPathToSegment(segment: string, index: number): string {
    const segments = this.getPathSegments();
    return segments.slice(0, index + 1).join('/');
  }

  /**
   * Navega a una ruta específica
   */
  navigateToPath(path: string): void {
    this.loading = true;
    this.errorMessage = null;
    // Normalizar el path (eliminar barras duplicadas, espacios, etc.)
    path = path.replace(/\/+/g, '/').replace(/\/$/, '').trim();
    this.currentPath = path;
    this.editablePath = path; // Actualizar la barra de dirección editable
    this.pathSegments = this.getPathSegments();
    this.isEditingPath = false;
    const startTime = new Date();
    
    this.sftpService.listDirectory(path).subscribe({
      next: (response) => {
        const duration = new Date().getTime() - startTime.getTime();
        this.loading = false;
        if (response.status) {
          this.files = response.files || [];
          this.updatePathHistory();
          this.addOperationLog('list', 'success', `Directorio listado: ${path || 'root'}`, {
            path,
            duration,
            fileCount: this.files.length
          });
        } else {
          const errorMsg = response.message || 'Error al listar directorio';
          this.errorMessage = errorMsg;
          this.addOperationLog('list', 'error', `Error al listar directorio: ${errorMsg}`, {
            path,
            duration,
            error: errorMsg
          });
        }
      },
      error: (error) => {
        const duration = new Date().getTime() - startTime.getTime();
        const errorMsg = error.error?.message || error.message || 'Error desconocido';
        this.loading = false;
        this.errorMessage = 'Error al conectar con el servidor SFTP';
        console.error('Error:', error);
        this.addOperationLog('list', 'error', `Error al listar directorio: ${errorMsg}`, {
          path,
          duration,
          error: errorMsg,
          errorCode: error.status?.toString()
        });
      }
    });
  }

  /**
   * Navega a un directorio
   */
  navigateToDirectory(directory: SftpFile): void {
    if (directory.isDirectory) {
      const newPath = directory.path || `${this.currentPath}/${directory.name}`.replace(/\/+/g, '/');
      this.navigateToPath(newPath);
    }
  }

  /**
   * Navega hacia atrás en el historial
   */
  navigateBack(): void {
    if (this.pathHistory.length > 1) {
      this.pathHistory.pop();
      const previousPath = this.pathHistory[this.pathHistory.length - 1];
      this.navigateToPath(previousPath);
    } else if (this.pathHistory.length === 1) {
      this.navigateToPath('');
    }
  }

  /**
   * Actualiza el historial de rutas
   */
  updatePathHistory(): void {
    if (!this.pathHistory.includes(this.currentPath)) {
      this.pathHistory.push(this.currentPath);
    }
  }

  /**
   * Abre el modal para crear nuevo archivo/carpeta
   */
  openCreateModal(type: 'file' | 'directory'): void {
    this.newItemType = type;
    this.newItemName = '';
    this.newItemContent = '';
    this.showCreateModal = true;
  }

  /**
   * Crea un nuevo archivo o directorio
   */
  createItem(): void {
    if (!this.newItemName.trim()) {
      this.errorMessage = 'El nombre no puede estar vacío';
      return;
    }

    this.loading = true;
    this.errorMessage = null;
    const startTime = new Date();

    if (this.newItemType === 'directory') {
      this.sftpService.createDirectory(this.currentPath, this.newItemName).subscribe({
        next: (response) => {
          const duration = new Date().getTime() - startTime.getTime();
          this.loading = false;
          if (response.status) {
            this.addOperationLog('create', 'success', `Directorio "${this.newItemName}" creado exitosamente`, {
              path: this.currentPath,
              fileName: this.newItemName,
              duration
            });
            this.showCreateModal = false;
            this.newItemName = '';
            this.newItemContent = '';
            this.navigateToPath(this.currentPath); // Refrescar lista
          } else {
            const errorMsg = response.message || 'Error al crear directorio';
            this.errorMessage = errorMsg;
            this.addOperationLog('create', 'error', `Error al crear directorio: ${errorMsg}`, {
              path: this.currentPath,
              fileName: this.newItemName,
              duration,
              error: errorMsg
            });
          }
        },
        error: (error) => {
          const duration = new Date().getTime() - startTime.getTime();
          const errorMsg = error.error?.message || error.message || 'Error desconocido';
          this.loading = false;
          this.errorMessage = 'Error al crear directorio';
          console.error('Error:', error);
          this.addOperationLog('create', 'error', `Error al crear directorio: ${errorMsg}`, {
            path: this.currentPath,
            fileName: this.newItemName,
            duration,
            error: errorMsg,
            errorCode: error.status?.toString()
          });
        }
      });
    } else {
      this.sftpService.createFile(this.currentPath, this.newItemName, this.newItemContent).subscribe({
        next: (response) => {
          const duration = new Date().getTime() - startTime.getTime();
          this.loading = false;
          if (response.status) {
            this.addOperationLog('create', 'success', `Archivo "${this.newItemName}" creado exitosamente`, {
              path: this.currentPath,
              fileName: this.newItemName,
              duration,
              fileSize: new Blob([this.newItemContent]).size
            });
            this.showCreateModal = false;
            this.newItemName = '';
            this.newItemContent = '';
            this.navigateToPath(this.currentPath); // Refrescar lista
          } else {
            const errorMsg = response.message || 'Error al crear archivo';
            this.errorMessage = errorMsg;
            this.addOperationLog('create', 'error', `Error al crear archivo: ${errorMsg}`, {
              path: this.currentPath,
              fileName: this.newItemName,
              duration,
              error: errorMsg
            });
          }
        },
        error: (error) => {
          const duration = new Date().getTime() - startTime.getTime();
          const errorMsg = error.error?.message || error.message || 'Error desconocido';
          this.loading = false;
          this.errorMessage = 'Error al crear archivo';
          console.error('Error:', error);
          this.addOperationLog('create', 'error', `Error al crear archivo: ${errorMsg}`, {
            path: this.currentPath,
            fileName: this.newItemName,
            duration,
            error: errorMsg,
            errorCode: error.status?.toString()
          });
        }
      });
    }
  }

  /**
   * Abre el modal para editar un archivo
   */
  openEditModal(file: SftpFile): void {
    if (file.isDirectory) {
      this.errorMessage = 'No se puede editar un directorio';
      return;
    }

    // Validar permisos antes de editar
    const permissionValidation = this.sftpValidator.validatePermissions('edit', file);
    if (!permissionValidation.isValid) {
      this.errorMessage = permissionValidation.errors.join(', ');
      return;
    }
    
    // Validar tamaño antes de editar
    if (file.size && file.size > 0) {
      const sizeValidation = this.sftpValidator.validateFileSize(file.size, 10);
      if (!sizeValidation.isValid) {
        this.errorMessage = sizeValidation.errors.join(', ');
        return;
      }
      if (sizeValidation.warnings.length > 0) {
        if (!confirm(`Advertencia: ${sizeValidation.warnings.join(', ')}\n\n¿Desea continuar editando?`)) {
          return;
        }
      }
    }

    this.editingFile = file;
    this.loading = true;
    this.errorMessage = null;
    const startTime = new Date();

    this.sftpService.getFileContent(file.path || file.name).subscribe({
      next: (response) => {
        const duration = new Date().getTime() - startTime.getTime();
        this.loading = false;
        if (response.status) {
          this.editContent = response.content || '';
          this.showEditModal = true;
          
          this.addOperationLog('edit', 'success', `Contenido del archivo "${file.name}" cargado`, {
            path: file.path,
            fileName: file.name,
            duration,
            fileSize: file.size
          });
          
          // Validar JSON si es un archivo JSON
          if (file.name.endsWith('.json')) {
            this.validationResult = this.sftpValidator.validateJsonContent(response.content || '');
          }
        } else {
          const errorMsg = response.message || 'Error al leer archivo';
          this.errorMessage = errorMsg;
          this.addOperationLog('edit', 'error', `Error al cargar archivo: ${errorMsg}`, {
            path: file.path,
            fileName: file.name,
            duration,
            error: errorMsg
          });
        }
      },
      error: (error) => {
        const duration = new Date().getTime() - startTime.getTime();
        const errorMsg = error.error?.message || error.message || 'Error desconocido';
        this.loading = false;
        this.errorMessage = 'Error al leer archivo';
        console.error('Error:', error);
        this.addOperationLog('edit', 'error', `Error al cargar archivo: ${errorMsg}`, {
          path: file.path,
          fileName: file.name,
          duration,
          error: errorMsg,
          errorCode: error.status?.toString()
        });
      }
    });
  }

  /**
   * Guarda los cambios en el archivo editado
   */
  saveFile(): void {
    if (!this.editingFile) return;

    // Validar contenido JSON si es un archivo JSON
    if (this.editingFile.name.endsWith('.json')) {
      this.validationResult = this.sftpValidator.validateJsonContent(this.editContent);
      if (!this.validationResult.isValid) {
        this.errorMessage = `Error en el contenido JSON: ${this.validationResult.errors.join(', ')}`;
        return;
      }
      if (this.validationResult.warnings.length > 0) {
        const warnings = this.validationResult.warnings.join(', ');
        if (!confirm(`Advertencias en el JSON: ${warnings}\n\n¿Desea continuar guardando?`)) {
          return;
        }
      }
    }

    this.loading = true;
    this.errorMessage = null;
    const startTime = new Date();

    this.sftpService.updateFile(this.editingFile.path || this.editingFile.name, this.editContent).subscribe({
      next: (response) => {
        this.loading = false;
        if (response.status) {
          this.showEditModal = false;
          this.editingFile = null;
          this.navigateToPath(this.currentPath); // Refrescar lista
        } else {
          this.errorMessage = response.message || 'Error al guardar archivo';
        }
      },
      error: (error) => {
        this.loading = false;
        this.errorMessage = 'Error al guardar archivo';
        console.error('Error:', error);
      }
    });
  }

  /**
   * Abre el modal para confirmar eliminación
   */
  openDeleteModal(item: SftpFile): void {
    this.deletingItem = item;
    this.showDeleteModal = true;
  }

  /**
   * Elimina un archivo o directorio
   */
  deleteItem(): void {
    if (!this.deletingItem) return;

    // Validar permisos antes de eliminar
    const permissionValidation = this.sftpValidator.validatePermissions('delete', this.deletingItem);
    if (!permissionValidation.isValid) {
      this.errorMessage = permissionValidation.errors.join(', ');
      return;
    }
    if (permissionValidation.warnings.length > 0) {
      const warnings = permissionValidation.warnings.join(', ');
      if (!confirm(`Advertencia: ${warnings}\n\n¿Está seguro de eliminar "${this.deletingItem.name}"?`)) {
        return;
      }
    }

    this.loading = true;
    this.errorMessage = null;
    const startTime = new Date();

    if (this.deletingItem.isDirectory) {
      this.sftpService.deleteDirectory(this.deletingItem.path || this.deletingItem.name).subscribe({
        next: (response) => {
          const duration = new Date().getTime() - startTime.getTime();
          this.loading = false;
          if (response.status) {
            this.addOperationLog('delete', 'success', `Directorio "${this.deletingItem!.name}" eliminado exitosamente`, {
              path: this.deletingItem!.path,
              fileName: this.deletingItem!.name,
              duration
            });
            this.showDeleteModal = false;
            this.deletingItem = null;
            this.navigateToPath(this.currentPath); // Refrescar lista
          } else {
            const errorMsg = response.message || 'Error al eliminar directorio';
            this.errorMessage = errorMsg;
            this.addOperationLog('delete', 'error', `Error al eliminar directorio: ${errorMsg}`, {
              path: this.deletingItem!.path,
              fileName: this.deletingItem!.name,
              duration,
              error: errorMsg
            });
          }
        },
        error: (error) => {
          const duration = new Date().getTime() - startTime.getTime();
          const errorMsg = error.error?.message || error.message || 'Error desconocido';
          this.loading = false;
          this.errorMessage = 'Error al eliminar directorio';
          console.error('Error:', error);
          this.addOperationLog('delete', 'error', `Error al eliminar directorio: ${errorMsg}`, {
            path: this.deletingItem!.path,
            fileName: this.deletingItem!.name,
            duration,
            error: errorMsg,
            errorCode: error.status?.toString()
          });
        }
      });
    } else {
      this.sftpService.deleteFile(this.deletingItem.path || this.deletingItem.name).subscribe({
        next: (response) => {
          const duration = new Date().getTime() - startTime.getTime();
          this.loading = false;
          if (response.status) {
            this.addOperationLog('delete', 'success', `Archivo "${this.deletingItem!.name}" eliminado exitosamente`, {
              path: this.deletingItem!.path,
              fileName: this.deletingItem!.name,
              duration
            });
            this.showDeleteModal = false;
            this.deletingItem = null;
            this.navigateToPath(this.currentPath); // Refrescar lista
          } else {
            const errorMsg = response.message || 'Error al eliminar archivo';
            this.errorMessage = errorMsg;
            this.addOperationLog('delete', 'error', `Error al eliminar archivo: ${errorMsg}`, {
              path: this.deletingItem!.path,
              fileName: this.deletingItem!.name,
              duration,
              error: errorMsg
            });
          }
        },
        error: (error) => {
          const duration = new Date().getTime() - startTime.getTime();
          const errorMsg = error.error?.message || error.message || 'Error desconocido';
          this.loading = false;
          this.errorMessage = 'Error al eliminar archivo';
          console.error('Error:', error);
          this.addOperationLog('delete', 'error', `Error al eliminar archivo: ${errorMsg}`, {
            path: this.deletingItem!.path,
            fileName: this.deletingItem!.name,
            duration,
            error: errorMsg,
            errorCode: error.status?.toString()
          });
        }
      });
    }
  }

  /**
   * Formatea el tamaño del archivo
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Formatea la fecha
   */
  formatDate(dateString: string): string {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('es-ES');
  }

  /**
   * Obtiene el icono según el tipo de archivo
   */
  getFileIcon(file: SftpFile): string {
    if (file.isDirectory) {
      return 'bi-folder-fill';
    }
    const ext = file.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'json':
        return 'bi-filetype-json';
      case 'txt':
        return 'bi-filetype-txt';
      case 'csv':
        return 'bi-filetype-csv';
      case 'xml':
        return 'bi-filetype-xml';
      default:
        return 'bi-file-earmark';
    }
  }

  /**
   * Descarga un archivo del servidor SFTP
   */
  downloadFile(file: SftpFile): void {
    if (file.isDirectory) {
      this.errorMessage = 'No se puede descargar un directorio';
      return;
    }

    // Validar tamaño antes de descargar
    if (file.size && file.size > 0) {
      const sizeValidation = this.sftpValidator.validateFileSize(file.size, 50); // 50 MB para descargas
      if (!sizeValidation.isValid) {
        this.errorMessage = sizeValidation.errors.join(', ');
        return;
      }
      if (sizeValidation.warnings.length > 0) {
        const warnings = sizeValidation.warnings.join(', ');
        if (!confirm(`Advertencia: ${warnings}\n\n¿Desea continuar descargando?`)) {
          return;
        }
      }
    }

    this.loading = true;
    this.errorMessage = null;
    const startTime = new Date();
    const filePath = file.path || file.name;
    
    this.sftpService.downloadFile(filePath).subscribe({
      next: (blob: Blob) => {
        const duration = new Date().getTime() - startTime.getTime();
        this.loading = false;
        
        // Crear un enlace temporal para descargar el archivo
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
        this.addOperationLog('download', 'success', `Archivo "${file.name}" descargado exitosamente`, {
          path: filePath,
          fileName: file.name,
          duration,
          fileSize: blob.size
        });
      },
      error: (error) => {
        const duration = new Date().getTime() - startTime.getTime();
        const errorMsg = error.error?.message || error.message || 'Error desconocido';
        this.loading = false;
        this.errorMessage = 'Error al descargar el archivo';
        console.error('Error:', error);
        this.addOperationLog('download', 'error', `Error al descargar archivo: ${errorMsg}`, {
          path: filePath,
          fileName: file.name,
          duration,
          error: errorMsg,
          errorCode: error.status?.toString()
        });
      }
    });
  }

  /**
   * Agrega un log de operación
   */
  addOperationLog(operation: string, status: 'success' | 'error' | 'warning', message: string, data?: any): void {
    const log: SftpOperationLog = {
      timestamp: new Date(),
      type: operation as 'create' | 'edit' | 'delete' | 'download' | 'navigate' | 'list',
      status,
      message,
      ...(data || {})
    };
    this.operationLogs.unshift(log); // Agregar al inicio
    // Mantener solo los últimos 100 logs
    if (this.operationLogs.length > 100) {
      this.operationLogs = this.operationLogs.slice(0, 100);
    }
  }

  /**
   * Alterna el panel de información
   */
  toggleInfoPanel(): void {
    this.showInfoPanel = !this.showInfoPanel;
  }

  /**
   * Alterna el panel de logs
   */
  toggleLogsPanel(): void {
    this.showLogsPanel = !this.showLogsPanel;
  }

  /**
   * Muestra información del archivo
   */
  showFileInfo(file: SftpFile): void {
    this.fileDetails = {
      name: file.name,
      type: file.isDirectory ? 'directory' : 'file',
      size: file.size || 0,
      modified: file.modifiedDate || '-',
      extension: file.name.includes('.') ? file.name.split('.').pop() : null,
      isJson: file.name.endsWith('.json'),
      estimatedLines: file.size ? Math.ceil(file.size / 50) : null
    };
    this.showInfoPanel = true;
    
    // Cargar preview si es JSON
    if (this.fileDetails.isJson) {
      this.loadFilePreview(file);
    } else {
      this.filePreview = null;
      this.showPreview = false;
    }
    
    // Validar si es JSON
    if (this.fileDetails.isJson) {
      // La validación se hará cuando se cargue el contenido
    }
  }

  /**
   * Carga el preview del archivo
   */
  loadFilePreview(file: SftpFile): void {
    this.loading = true;
    this.sftpService.getFileContent(file.path || file.name).subscribe({
      next: (response) => {
        this.loading = false;
        if (response.status && response.content) {
          this.filePreview = response.content;
          this.showPreview = true;
          
          // Validar JSON
          if (file.name.endsWith('.json')) {
            this.validationResult = this.sftpValidator.validateJsonContent(response.content);
          }
        } else {
          this.filePreview = null;
          this.showPreview = false;
        }
      },
      error: (error) => {
        this.loading = false;
        this.filePreview = null;
        this.showPreview = false;
        console.error('Error al cargar preview:', error);
      }
    });
  }

  /**
   * Limpia los logs de operación
   */
  clearOperationLogs(): void {
    this.operationLogs = [];
  }

  /**
   * Exporta los logs de operación
   */
  exportOperationLogs(): void {
    const logsText = this.operationLogs.map(log => {
      const logData: any = {
        path: log.path,
        fileName: log.fileName,
        duration: log.duration,
        error: log.error,
        errorCode: log.errorCode,
        fileSize: log.fileSize
      };
      const dataStr = this.getLogDataString(logData);
      return `[${log.timestamp.toLocaleString()}] ${log.type.toUpperCase()} - ${log.status.toUpperCase()}: ${log.message}${dataStr ? '\n  Data: ' + dataStr : ''}`;
    }).join('\n\n');
    
    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sftp-operation-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  /**
   * Formatea la duración en milisegundos a string legible
   */
  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(2);
    return `${minutes}m ${seconds}s`;
  }

  /**
   * Convierte el objeto data del log a string
   */
  getLogDataString(data: any): string {
    if (!data || Object.keys(data).length === 0) return '';
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }

  /**
   * Getters para contar logs por estado
   */
  getOperationErrorsCount(): number {
    return this.operationLogs.filter(l => l.status === 'error').length;
  }

  getOperationWarningsCount(): number {
    return this.operationLogs.filter(l => l.status === 'warning').length;
  }

  getOperationSuccessCount(): number {
    return this.operationLogs.filter(l => l.status === 'success').length;
  }

  getOperationTotalCount(): number {
    return this.operationLogs.length;
  }
}

