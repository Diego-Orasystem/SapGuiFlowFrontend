import { Injectable } from '@angular/core';

export interface TemplateValidationError {
  type: 'error' | 'warning' | 'info';
  message: string;
  field?: string;
  formId?: string;
  tcode?: string;
}

export interface TemplateValidationResult {
  isValid: boolean;
  errors: TemplateValidationError[];
  warnings: TemplateValidationError[];
  info: TemplateValidationError[];
  summary: {
    totalForms: number;
    formsWithErrors: number;
    formsWithWarnings: number;
    missingRequiredFields: number;
    invalidFlowReferences: number;
    duplicateNames: number;
  };
}

export interface TemplateForm {
  id: string;
  tcode: string;
  customName: string;
  jsonData: any;
  parameters: string[];
  defaultValues: { [key: string]: any };
}

export interface SyncTemplate {
  id: string;
  name: string;
  type: 'SUMMARY_SYNC' | 'DETAILS_SYNC' | 'CUSTOM';
  forms: TemplateForm[];
}

@Injectable({
  providedIn: 'root'
})
export class TemplateValidatorService {
  
  /**
   * Valida una plantilla completa
   */
  validateTemplate(template: SyncTemplate, availableFlowNames?: string[]): TemplateValidationResult {
    const result: TemplateValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      info: [],
      summary: {
        totalForms: 0,
        formsWithErrors: 0,
        formsWithWarnings: 0,
        missingRequiredFields: 0,
        invalidFlowReferences: 0,
        duplicateNames: 0
      }
    };

    if (!template) {
      result.errors.push({
        type: 'error',
        message: 'La plantilla está vacía o no es válida'
      });
      result.isValid = false;
      return result;
    }

    // Validar estructura básica
    this.validateTemplateStructure(template, result);
    
    // Validar nombre de plantilla
    this.validateTemplateName(template.name, result);
    
    // Validar cada formulario
    if (template.forms && Array.isArray(template.forms)) {
      result.summary.totalForms = template.forms.length;
      
      template.forms.forEach(form => {
        this.validateForm(form, result, availableFlowNames);
      });
    }
    
    // Validar nombres duplicados
    this.validateDuplicateNames(template, result);
    
    // Validar referencias a flujos
    this.validateFlowReferences(template, result, availableFlowNames);
    
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
   * Valida la estructura básica de la plantilla
   */
  private validateTemplateStructure(template: SyncTemplate, result: TemplateValidationResult): void {
    if (!template.name || template.name.trim() === '') {
      result.errors.push({
        type: 'error',
        message: 'La plantilla debe tener un nombre',
        field: 'name'
      });
    }

    if (!template.type || !['SUMMARY_SYNC', 'DETAILS_SYNC', 'CUSTOM'].includes(template.type)) {
      result.errors.push({
        type: 'error',
        message: 'La plantilla debe tener un tipo válido (SUMMARY_SYNC, DETAILS_SYNC o CUSTOM)',
        field: 'type'
      });
    }

    if (!template.forms || !Array.isArray(template.forms)) {
      result.errors.push({
        type: 'error',
        message: 'La plantilla debe tener una lista de formularios',
        field: 'forms'
      });
    } else if (template.forms.length === 0) {
      result.warnings.push({
        type: 'warning',
        message: 'La plantilla no tiene formularios. No se generará ningún archivo.',
        field: 'forms'
      });
    }
  }

  /**
   * Valida el nombre de la plantilla
   */
  private validateTemplateName(name: string, result: TemplateValidationResult): void {
    if (!name || name.trim() === '') {
      return; // Ya se valida en validateTemplateStructure
    }

    // Validar formato del nombre
    if (name.includes(' ')) {
      result.warnings.push({
        type: 'warning',
        message: 'El nombre de la plantilla contiene espacios. Se recomienda usar guiones o guiones bajos.',
        field: 'name'
      });
    }

    // Validar caracteres especiales
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(name)) {
      result.errors.push({
        type: 'error',
        message: `El nombre de la plantilla contiene caracteres inválidos: ${name}`,
        field: 'name'
      });
    }

    // Validar longitud
    if (name.length > 100) {
      result.warnings.push({
        type: 'warning',
        message: 'El nombre de la plantilla es muy largo (más de 100 caracteres)',
        field: 'name'
      });
    }
  }

  /**
   * Valida un formulario individual
   */
  private validateForm(form: TemplateForm, result: TemplateValidationResult, availableFlowNames?: string[]): void {
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
      result.summary.invalidFlowReferences++;
    } else {
      // Validar estructura del JSON
      this.validateFormJsonData(form.jsonData, form, result, availableFlowNames);
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

    // Validar defaultValues
    if (form.defaultValues && typeof form.defaultValues === 'object') {
      // Verificar que los parámetros requeridos tengan valores por defecto
      if (form.parameters && form.parameters.length > 0) {
        form.parameters.forEach(param => {
          if (!(param in form.defaultValues)) {
            result.warnings.push({
              type: 'warning',
              message: `El parámetro "${param}" no tiene un valor por defecto`,
              formId: form.id,
              tcode: form.tcode,
              field: `defaultValues.${param}`
            });
          }
        });
      }
    }
  }

  /**
   * Valida la estructura del JSON del formulario
   */
  private validateFormJsonData(jsonData: any, form: TemplateForm, result: TemplateValidationResult, availableFlowNames?: string[]): void {
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

    // Validar que el flujo existe si se proporciona la lista
    if (availableFlowNames && jsonData.$meta && jsonData.$meta.tcode) {
      const flowName = `${jsonData.$meta.tcode.toLowerCase()}.json`;
      if (!availableFlowNames.includes(flowName) && !availableFlowNames.some(f => f.toLowerCase() === flowName.toLowerCase())) {
        result.warnings.push({
          type: 'warning',
          message: `El flujo referenciado (${jsonData.$meta.tcode}) podría no existir en el servidor`,
          formId: form.id,
          tcode: form.tcode,
          field: 'jsonData.$meta.tcode'
        });
        result.summary.invalidFlowReferences++;
      }
    }
  }

  /**
   * Valida nombres duplicados
   */
  private validateDuplicateNames(template: SyncTemplate, result: TemplateValidationResult): void {
    if (!template.forms || !Array.isArray(template.forms)) {
      return;
    }

    const customNames = new Map<string, string[]>(); // customName -> [formIds]
    const tcodes = new Map<string, string[]>(); // tcode -> [formIds]

    template.forms.forEach(form => {
      if (form.customName) {
        if (!customNames.has(form.customName)) {
          customNames.set(form.customName, []);
        }
        customNames.get(form.customName)!.push(form.id);
      }

      if (form.tcode) {
        if (!tcodes.has(form.tcode)) {
          tcodes.set(form.tcode, []);
        }
        tcodes.get(form.tcode)!.push(form.id);
      }
    });

    // Verificar duplicados de customName
    customNames.forEach((formIds, customName) => {
      if (formIds.length > 1) {
        result.errors.push({
          type: 'error',
          message: `El nombre personalizado "${customName}" está duplicado en ${formIds.length} formularios`,
          field: 'customName',
          formId: formIds[0]
        });
        result.summary.duplicateNames++;
      }
    });
  }

  /**
   * Valida referencias a flujos
   */
  private validateFlowReferences(template: SyncTemplate, result: TemplateValidationResult, availableFlowNames?: string[]): void {
    if (!availableFlowNames || availableFlowNames.length === 0) {
      return; // No se puede validar sin la lista de flujos disponibles
    }

    template.forms?.forEach(form => {
      if (form.jsonData && form.jsonData.$meta && form.jsonData.$meta.tcode) {
        const flowName = `${form.jsonData.$meta.tcode.toLowerCase()}.json`;
        if (!availableFlowNames.includes(flowName) && !availableFlowNames.some(f => f.toLowerCase() === flowName.toLowerCase())) {
          result.warnings.push({
            type: 'warning',
            message: `El flujo referenciado (${form.jsonData.$meta.tcode}) no se encontró en el servidor`,
            formId: form.id,
            tcode: form.tcode,
            field: 'jsonData.$meta.tcode'
          });
          result.summary.invalidFlowReferences++;
        }
      } else {
        result.errors.push({
          type: 'error',
          message: 'El formulario no referencia un flujo válido',
          formId: form.id,
          tcode: form.tcode
        });
        result.summary.invalidFlowReferences++;
      }
    });
  }

  /**
   * Simula la aplicación de fechas a una plantilla
   */
  simulateDateApplication(template: SyncTemplate, dateRange: { startDate: string; endDate?: string; periodType: 'month' | 'day' }): any {
    const result: any = {};
    
    template.forms?.forEach(form => {
      const formData: any = { ...form.defaultValues };
      
      // Aplicar formato de fecha según el tipo de período
      let dateFormat: string;
      if (dateRange.periodType === 'month') {
        // Formato YYYYMM para SUMMARY_SYNC
        const d = new Date(dateRange.startDate);
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        dateFormat = `${year}${month}`;
      } else {
        // Formato DD.MM.YYYY para DETAILS_SYNC
        const d = new Date(dateRange.startDate);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        dateFormat = `${day}.${month}.${year}`;
      }
      
      // Buscar y actualizar campos de fecha
      Object.keys(formData).forEach(key => {
        const keyLower = key.toLowerCase();
        if (keyLower.includes('date') && (keyLower.includes('low') || keyLower.includes('start'))) {
          formData[key] = dateFormat;
        }
        if (keyLower.includes('date') && (keyLower.includes('high') || keyLower.includes('end'))) {
          formData[key] = dateFormat;
        }
      });
      
      result[form.customName || form.tcode] = formData;
    });
    
    return result;
  }

  /**
   * Compara dos versiones de una plantilla
   */
  compareTemplates(oldTemplate: SyncTemplate, newTemplate: SyncTemplate): {
    differences: string[];
    addedForms: string[];
    removedForms: string[];
    modifiedForms: string[];
  } {
    const differences: string[] = [];
    const addedForms: string[] = [];
    const removedForms: string[] = [];
    const modifiedForms: string[] = [];

    // Comparar nombre
    if (oldTemplate.name !== newTemplate.name) {
      differences.push(`Nombre: "${oldTemplate.name}" → "${newTemplate.name}"`);
    }

    // Comparar tipo
    if (oldTemplate.type !== newTemplate.type) {
      differences.push(`Tipo: "${oldTemplate.type}" → "${newTemplate.type}"`);
    }

    // Comparar formularios
    const oldFormIds = new Set(oldTemplate.forms?.map(f => f.id) || []);
    const newFormIds = new Set(newTemplate.forms?.map(f => f.id) || []);

    // Formularios agregados
    newFormIds.forEach(id => {
      if (!oldFormIds.has(id)) {
        const form = newTemplate.forms?.find(f => f.id === id);
        addedForms.push(form?.customName || form?.tcode || id);
      }
    });

    // Formularios eliminados
    oldFormIds.forEach(id => {
      if (!newFormIds.has(id)) {
        const form = oldTemplate.forms?.find(f => f.id === id);
        removedForms.push(form?.customName || form?.tcode || id);
      }
    });

    // Formularios modificados
    oldFormIds.forEach(id => {
      if (newFormIds.has(id)) {
        const oldForm = oldTemplate.forms?.find(f => f.id === id);
        const newForm = newTemplate.forms?.find(f => f.id === id);
        
        if (oldForm && newForm) {
          const formChanged = 
            oldForm.tcode !== newForm.tcode ||
            oldForm.customName !== newForm.customName ||
            JSON.stringify(oldForm.defaultValues) !== JSON.stringify(newForm.defaultValues) ||
            JSON.stringify(oldForm.parameters) !== JSON.stringify(newForm.parameters);
          
          if (formChanged) {
            modifiedForms.push(newForm.customName || newForm.tcode || id);
          }
        }
      }
    });

    if (addedForms.length > 0) {
      differences.push(`Formularios agregados: ${addedForms.join(', ')}`);
    }
    if (removedForms.length > 0) {
      differences.push(`Formularios eliminados: ${removedForms.join(', ')}`);
    }
    if (modifiedForms.length > 0) {
      differences.push(`Formularios modificados: ${modifiedForms.join(', ')}`);
    }

    return {
      differences,
      addedForms,
      removedForms,
      modifiedForms
    };
  }
}




