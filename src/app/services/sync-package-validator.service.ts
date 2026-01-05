import { Injectable } from '@angular/core';

export interface PackageValidationError {
  type: 'error' | 'warning' | 'info';
  message: string;
  field?: string;
  formId?: string;
  tcode?: string;
}

export interface PackageValidationResult {
  isValid: boolean;
  errors: PackageValidationError[];
  warnings: PackageValidationError[];
  info: PackageValidationError[];
  summary: {
    totalForms: number;
    formsWithErrors: number;
    formsWithWarnings: number;
    missingRequiredFields: number;
    invalidDates: number;
    missingFlows: number;
  };
}

export interface Form {
  id: string;
  tcode: string;
  customName: string;
  jsonData: any;
  parameters: string[];
}

export interface Package {
  id: string;
  name: string;
  forms: Form[];
}

export interface ExecutionStep {
  id: string;
  formId: string;
  formName: string;
  fileName: string;
  status: 'pending' | 'executing' | 'completed' | 'error';
  startTime?: Date;
  endTime?: Date;
  duration?: number; // en milisegundos
  error?: string;
  fileSize?: number;
  data?: any; // Datos adicionales del step
  validationResult?: { isValid: boolean; errors: string[]; warnings: string[] }; // Resultado de validación
}

export interface ExecutionLog {
  timestamp: Date;
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  stepId?: string;
  data?: any;
}

@Injectable({
  providedIn: 'root'
})
export class SyncPackageValidatorService {
  
  /**
   * Valida un paquete completo antes de ejecutar
   */
  validatePackage(packageData: Package, dateRange?: { startDate: string; endDate?: string; periodType: 'month' | 'day' }): PackageValidationResult {
    const result: PackageValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      info: [],
      summary: {
        totalForms: 0,
        formsWithErrors: 0,
        formsWithWarnings: 0,
        missingRequiredFields: 0,
        invalidDates: 0,
        missingFlows: 0
      }
    };

    if (!packageData) {
      result.errors.push({
        type: 'error',
        message: 'El paquete está vacío o no es válido'
      });
      result.isValid = false;
      return result;
    }

    // Validar estructura básica
    this.validatePackageStructure(packageData, result);
    
    // Validar cada formulario
    if (packageData.forms && Array.isArray(packageData.forms)) {
      result.summary.totalForms = packageData.forms.length;
      
      packageData.forms.forEach(form => {
        this.validateForm(form, result);
      });
    }
    
    // Validar fechas si se proporcionan
    if (dateRange) {
      this.validateDates(dateRange, result);
    }
    
    // Validar que los flujos referenciados existen (si es posible)
    this.validateFlowReferences(packageData, result);
    
    // Validar parámetros requeridos
    this.validateRequiredParameters(packageData, result);
    
    // Actualizar isValid basado en errores
    result.isValid = result.errors.length === 0;
    
    // Actualizar resumen
    result.summary.formsWithErrors = new Set(
      result.errors.filter(e => e.formId).map(e => e.formId!)
    ).size;
    result.summary.formsWithWarnings = new Set(
      result.warnings.filter(w => w.formId).map(w => w.formId!)
    ).size;

    return result;
  }

  /**
   * Valida la estructura básica del paquete
   */
  private validatePackageStructure(packageData: Package, result: PackageValidationResult): void {
    if (!packageData.name || packageData.name.trim() === '') {
      result.errors.push({
        type: 'error',
        message: 'El paquete debe tener un nombre',
        field: 'name'
      });
    }

    if (!packageData.forms || !Array.isArray(packageData.forms)) {
      result.errors.push({
        type: 'error',
        message: 'El paquete debe tener una lista de formularios',
        field: 'forms'
      });
    } else if (packageData.forms.length === 0) {
      result.warnings.push({
        type: 'warning',
        message: 'El paquete no tiene formularios. No se generará ningún archivo.',
        field: 'forms'
      });
    }
  }

  /**
   * Valida un formulario individual
   */
  private validateForm(form: Form, result: PackageValidationResult): void {
    if (!form.id) {
      result.errors.push({
        type: 'error',
        message: 'Un formulario no tiene ID',
        formId: form.id,
        tcode: form.tcode
      });
    }

    if (!form.tcode || form.tcode.trim() === '') {
      result.errors.push({
        type: 'error',
        message: 'El formulario debe tener un T-Code',
        formId: form.id,
        field: 'tcode'
      });
      result.summary.missingRequiredFields++;
    }

    if (!form.customName || form.customName.trim() === '') {
      result.warnings.push({
        type: 'warning',
        message: 'El formulario no tiene un nombre personalizado. Se usará el T-Code.',
        formId: form.id,
        tcode: form.tcode,
        field: 'customName'
      });
    }

    if (!form.jsonData) {
      result.errors.push({
        type: 'error',
        message: 'El formulario no tiene datos JSON',
        formId: form.id,
        tcode: form.tcode,
        field: 'jsonData'
      });
      result.summary.missingFlows++;
    } else {
      // Validar estructura del JSON
      this.validateFormJsonData(form.jsonData, form, result);
    }

    if (!form.parameters || !Array.isArray(form.parameters)) {
      result.warnings.push({
        type: 'warning',
        message: 'El formulario no tiene parámetros definidos',
        formId: form.id,
        tcode: form.tcode,
        field: 'parameters'
      });
    }
  }

  /**
   * Valida la estructura del JSON del formulario
   */
  private validateFormJsonData(jsonData: any, form: Form, result: PackageValidationResult): void {
    if (!jsonData.$meta) {
      result.errors.push({
        type: 'error',
        message: 'El JSON del formulario no tiene sección $meta',
        formId: form.id,
        tcode: form.tcode,
        field: 'jsonData.$meta'
      });
    } else {
      if (!jsonData.$meta.tcode) {
        result.errors.push({
          type: 'error',
          message: 'El JSON del formulario no tiene $meta.tcode',
          formId: form.id,
          tcode: form.tcode,
          field: 'jsonData.$meta.tcode'
        });
      } else if (jsonData.$meta.tcode !== form.tcode) {
        result.warnings.push({
          type: 'warning',
          message: `El T-Code del formulario (${form.tcode}) no coincide con el T-Code del JSON (${jsonData.$meta.tcode})`,
          formId: form.id,
          tcode: form.tcode,
          field: 'tcode'
        });
      }
    }

    if (!jsonData.targetContext || typeof jsonData.targetContext !== 'object') {
      result.warnings.push({
        type: 'warning',
        message: 'El JSON del formulario no tiene targetContext definido',
        formId: form.id,
        tcode: form.tcode,
        field: 'jsonData.targetContext'
      });
    }

    if (!jsonData.steps || typeof jsonData.steps !== 'object') {
      result.warnings.push({
        type: 'warning',
        message: 'El JSON del formulario no tiene steps definidos',
        formId: form.id,
        tcode: form.tcode,
        field: 'jsonData.steps'
      });
    }
  }

  /**
   * Valida las fechas proporcionadas
   */
  private validateDates(dateRange: { startDate: string; endDate?: string; periodType: 'month' | 'day' }, result: PackageValidationResult): void {
    // Validar formato de fecha de inicio
    if (!dateRange.startDate) {
      result.errors.push({
        type: 'error',
        message: 'La fecha de inicio es requerida',
        field: 'startDate'
      });
      result.summary.invalidDates++;
      return;
    }

    const startDate = new Date(dateRange.startDate);
    if (isNaN(startDate.getTime())) {
      result.errors.push({
        type: 'error',
        message: `La fecha de inicio tiene un formato inválido: ${dateRange.startDate}`,
        field: 'startDate'
      });
      result.summary.invalidDates++;
    }

    // Validar fecha de fin si se proporciona
    if (dateRange.endDate) {
      const endDate = new Date(dateRange.endDate);
      if (isNaN(endDate.getTime())) {
        result.errors.push({
          type: 'error',
          message: `La fecha de fin tiene un formato inválido: ${dateRange.endDate}`,
          field: 'endDate'
        });
        result.summary.invalidDates++;
      } else if (startDate > endDate) {
        result.errors.push({
          type: 'error',
          message: 'La fecha de inicio no puede ser posterior a la fecha de fin',
          field: 'startDate'
        });
        result.summary.invalidDates++;
      }
    }

    // Validar tipo de período
    if (dateRange.periodType && !['month', 'day'].includes(dateRange.periodType)) {
      result.errors.push({
        type: 'error',
        message: `El tipo de período debe ser 'month' o 'day', se recibió: ${dateRange.periodType}`,
        field: 'periodType'
      });
    }
  }

  /**
   * Valida que los flujos referenciados existen (validación básica)
   */
  private validateFlowReferences(packageData: Package, result: PackageValidationResult): void {
    // Esta validación es básica, ya que no tenemos acceso directo a la lista de flujos disponibles
    // Se puede mejorar si se proporciona una lista de flujos disponibles
    packageData.forms?.forEach(form => {
      if (form.jsonData && form.jsonData.$meta && form.jsonData.$meta.tcode) {
        // Validación básica: verificar que el tcode no esté vacío
        if (form.jsonData.$meta.tcode.trim() === '') {
          result.errors.push({
            type: 'error',
            message: 'El T-Code del flujo está vacío',
            formId: form.id,
            tcode: form.tcode,
            field: 'jsonData.$meta.tcode'
          });
          result.summary.missingFlows++;
        }
      } else {
        result.errors.push({
          type: 'error',
          message: 'El formulario no referencia un flujo válido',
          formId: form.id,
          tcode: form.tcode
        });
        result.summary.missingFlows++;
      }
    });
  }

  /**
   * Valida parámetros requeridos
   */
  private validateRequiredParameters(packageData: Package, result: PackageValidationResult): void {
    packageData.forms?.forEach(form => {
      if (!form.parameters || form.parameters.length === 0) {
        result.warnings.push({
          type: 'warning',
          message: 'El formulario no tiene parámetros definidos. Algunos parámetros pueden ser requeridos.',
          formId: form.id,
          tcode: form.tcode,
          field: 'parameters'
        });
      }
    });
  }

  /**
   * Valida un archivo generado después de guardar
   */
  validateGeneratedFile(fileName: string, fileSize: number, expectedSize?: number): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validar nombre del archivo
    if (!fileName || fileName.trim() === '') {
      errors.push('El nombre del archivo está vacío');
    } else {
      // Validar formato del nombre (debe terminar en .sqpr)
      if (!fileName.endsWith('.sqpr')) {
        errors.push(`El nombre del archivo no tiene la extensión correcta: ${fileName}`);
      }

      // Validar que el nombre tiene el formato esperado (ID-TCODE@startDate=FECHA.sqpr)
      const pattern = /^[A-F0-9]{8}-[A-Z0-9_#]+@startDate=[\d.]+\.sqpr$/;
      if (!pattern.test(fileName)) {
        warnings.push(`El nombre del archivo no sigue el formato esperado: ${fileName}`);
      }
    }

    // Validar tamaño del archivo
    if (fileSize <= 0) {
      errors.push('El archivo generado está vacío');
    } else if (expectedSize && fileSize < expectedSize * 0.5) {
      warnings.push(`El tamaño del archivo (${fileSize} bytes) es significativamente menor al esperado (${expectedSize} bytes)`);
    } else if (expectedSize && fileSize > expectedSize * 2) {
      warnings.push(`El tamaño del archivo (${fileSize} bytes) es significativamente mayor al esperado (${expectedSize} bytes)`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
}

