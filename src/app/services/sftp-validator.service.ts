import { Injectable } from '@angular/core';
import { SftpFile } from './sftp.service';

export interface SftpOperationLog {
  timestamp: Date;
  type: 'create' | 'edit' | 'delete' | 'download' | 'navigate' | 'list';
  status: 'success' | 'error' | 'warning';
  message: string;
  path?: string;
  fileName?: string;
  duration?: number; // en milisegundos
  error?: string;
  errorCode?: string;
  fileSize?: number;
}

export interface FileValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  isJsonValid?: boolean;
  jsonErrors?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class SftpValidatorService {
  
  // Caracteres inválidos en nombres de archivos/carpetas
  private readonly invalidFileNameChars = /[<>:"/\\|?*\x00-\x1f]/;
  
  // Nombres reservados en sistemas Windows/Linux
  private readonly reservedNames = [
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
    '.', '..'
  ];
  
  /**
   * Valida un nombre de archivo o carpeta
   */
  validateFileName(name: string, type: 'file' | 'directory'): FileValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (!name || name.trim() === '') {
      errors.push('El nombre no puede estar vacío');
      return { isValid: false, errors, warnings };
    }
    
    const trimmedName = name.trim();
    
    // Validar longitud
    if (trimmedName.length > 255) {
      errors.push('El nombre no puede tener más de 255 caracteres');
    }
    
    // Validar caracteres inválidos
    if (this.invalidFileNameChars.test(trimmedName)) {
      errors.push('El nombre contiene caracteres inválidos: < > : " / \\ | ? * o caracteres de control');
    }
    
    // Validar nombres reservados
    const nameUpper = trimmedName.toUpperCase();
    if (this.reservedNames.includes(nameUpper)) {
      errors.push(`El nombre "${trimmedName}" es un nombre reservado del sistema`);
    }
    
    // Validar espacios al inicio/fin
    if (name !== trimmedName) {
      warnings.push('El nombre tiene espacios al inicio o al final que serán eliminados');
    }
    
    // Validar puntos al final (problema en Windows)
    if (trimmedName.endsWith('.') && trimmedName.length > 1) {
      warnings.push('El nombre termina con un punto, lo cual puede causar problemas en algunos sistemas');
    }
    
    // Validar espacios múltiples
    if (/\s{2,}/.test(trimmedName)) {
      warnings.push('El nombre contiene espacios múltiples consecutivos');
    }
    
    // Validar extensiones comunes para archivos
    if (type === 'file' && !trimmedName.includes('.')) {
      warnings.push('El archivo no tiene extensión');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  /**
   * Valida el tamaño de un archivo antes de descargar/editar
   */
  validateFileSize(fileSize: number, maxSizeMB: number = 10): FileValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    
    if (fileSize <= 0) {
      errors.push('El archivo está vacío');
    } else if (fileSize > maxSizeBytes) {
      errors.push(`El archivo es muy grande (${(fileSize / 1024 / 1024).toFixed(2)} MB). El tamaño máximo recomendado es ${maxSizeMB} MB`);
    } else if (fileSize > maxSizeBytes * 0.8) {
      warnings.push(`El archivo es grande (${(fileSize / 1024 / 1024).toFixed(2)} MB). La operación puede tardar`);
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  /**
   * Valida el contenido JSON antes de guardar
   */
  validateJsonContent(content: string): FileValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let isJsonValid = false;
    const jsonErrors: string[] = [];
    
    if (!content || content.trim() === '') {
      warnings.push('El contenido está vacío');
      return { isValid: true, errors, warnings, isJsonValid: false, jsonErrors };
    }
    
    // Intentar parsear como JSON
    try {
      JSON.parse(content);
      isJsonValid = true;
    } catch (error) {
      isJsonValid = false;
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido al parsear JSON';
      jsonErrors.push(errorMessage);
      errors.push(`El contenido no es un JSON válido: ${errorMessage}`);
    }
    
    // Validar estructura básica si es JSON válido
    if (isJsonValid) {
      try {
        const parsed = JSON.parse(content);
        
        // Validar que no esté vacío
        if (Object.keys(parsed).length === 0) {
          warnings.push('El JSON está vacío (objeto vacío)');
        }
        
        // Validar formato (prettify check)
        const formatted = JSON.stringify(parsed, null, 2);
        if (content.trim() !== formatted && content.trim() !== JSON.stringify(parsed)) {
          warnings.push('El JSON no está formateado. Se recomienda usar formato con indentación');
        }
      } catch (e) {
        // Ya validado arriba, no debería llegar aquí
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      isJsonValid,
      jsonErrors
    };
  }
  
  /**
   * Valida permisos antes de una operación (simulación, ya que el backend maneja los permisos reales)
   */
  validatePermissions(operation: 'create' | 'edit' | 'delete', file?: SftpFile): FileValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Esta es una validación básica del lado del cliente
    // Los permisos reales se validan en el servidor
    
    if (operation === 'delete' && file) {
      if (file.isDirectory) {
        warnings.push('Eliminar un directorio también eliminará todo su contenido');
      }
    }
    
    if (operation === 'edit' && file) {
      if (file.isDirectory) {
        errors.push('No se puede editar un directorio');
      }
      
      if (file.size && file.size > 10 * 1024 * 1024) {
        warnings.push('El archivo es grande. La edición puede ser lenta');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  /**
   * Formatea un tamaño de archivo de manera legible
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }
  
  /**
   * Obtiene información detallada de un archivo
   */
  getFileDetails(file: SftpFile): {
    name: string;
    path: string;
    type: string;
    size: string;
    modified: string;
    extension?: string;
    isJson?: boolean;
    estimatedLines?: number;
  } {
    const extension = file.name.includes('.') 
      ? file.name.split('.').pop()?.toLowerCase() 
      : undefined;
    
    const isJson = extension === 'json';
    const estimatedLines = file.size && file.size > 0 
      ? Math.ceil((file.size / 80)) // Estimación aproximada
      : undefined;
    
    return {
      name: file.name,
      path: file.path || '',
      type: file.isDirectory ? 'Directorio' : 'Archivo',
      size: file.isDirectory ? '-' : this.formatFileSize(file.size || 0),
      modified: file.modifiedDate ? new Date(file.modifiedDate).toLocaleString() : 'Desconocido',
      extension,
      isJson,
      estimatedLines
    };
  }
}




