import { Injectable } from '@angular/core';

export interface ValidationError {
  type: 'error' | 'warning' | 'info';
  message: string;
  field?: string;
  step?: string;
  container?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  info: ValidationError[];
  summary: {
    totalContainers: number;
    totalSteps: number;
    totalControls: number;
    missingConnections: number;
    duplicateNames: number;
  };
}

@Injectable({
  providedIn: 'root'
})
export class FlowValidatorService {
  
  // Tipos de acciones permitidas
  private readonly allowedActions = [
    'set', 'click', 'waitFor', 'condition', 'columns', 'columnsSum',
    'saveas', 'reset', 'callSubflow'
  ];

  /**
   * Valida un flujo SAP completo
   */
  validateFlow(flowData: any): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      info: [],
      summary: {
        totalContainers: 0,
        totalSteps: 0,
        totalControls: 0,
        missingConnections: 0,
        duplicateNames: 0
      }
    };

    if (!flowData) {
      result.errors.push({
        type: 'error',
        message: 'El flujo está vacío o no es válido'
      });
      result.isValid = false;
      return result;
    }

    // Validar estructura básica
    this.validateStructure(flowData, result);
    
    // Validar $meta
    this.validateMeta(flowData.$meta, result);
    
    // Validar targetContext
    this.validateTargetContext(flowData.targetContext, result);
    
    // Validar steps
    this.validateSteps(flowData.steps, flowData.targetContext, result);
    
    // Validar referencias entre steps
    this.validateStepReferences(flowData.steps, flowData.targetContext, result);
    
    // Validar conexiones entre contenedores
    this.validateContainerConnections(flowData.steps, result);
    
    // Validar nombres duplicados
    this.validateDuplicateNames(flowData, result);
    
    // Actualizar isValid basado en errores
    result.isValid = result.errors.length === 0;

    return result;
  }

  /**
   * Valida la estructura básica del flujo
   */
  private validateStructure(flowData: any, result: ValidationResult): void {
    if (!flowData.$meta) {
      result.errors.push({
        type: 'error',
        message: 'Falta la sección $meta en el flujo',
        field: '$meta'
      });
    }

    if (!flowData.targetContext) {
      result.warnings.push({
        type: 'warning',
        message: 'No hay targetContext definido (el flujo está vacío)',
        field: 'targetContext'
      });
    }

    if (!flowData.steps) {
      result.warnings.push({
        type: 'warning',
        message: 'No hay steps definidos (el flujo está vacío)',
        field: 'steps'
      });
    }
  }

  /**
   * Valida la sección $meta
   */
  private validateMeta(meta: any, result: ValidationResult): void {
    if (!meta) return;

    if (!meta.tcode) {
      result.errors.push({
        type: 'error',
        message: 'Falta el campo tcode en $meta',
        field: '$meta.tcode'
      });
    } else if (typeof meta.tcode !== 'string' || meta.tcode.trim() === '') {
      result.errors.push({
        type: 'error',
        message: 'El campo tcode en $meta debe ser una cadena no vacía',
        field: '$meta.tcode'
      });
    }

    if (meta.description && typeof meta.description !== 'string') {
      result.warnings.push({
        type: 'warning',
        message: 'El campo description en $meta debe ser una cadena',
        field: '$meta.description'
      });
    }
  }

  /**
   * Valida targetContext
   */
  private validateTargetContext(targetContext: any, result: ValidationResult): void {
    if (!targetContext || typeof targetContext !== 'object') {
      return;
    }

    result.summary.totalContainers = Object.keys(targetContext).length;

    // Validar que no hay claves vacías
    Object.keys(targetContext).forEach(key => {
      if (!key || key.trim() === '') {
        result.errors.push({
          type: 'error',
          message: 'Hay una clave vacía en targetContext',
          container: key
        });
      }
    });
  }

  /**
   * Valida steps
   */
  private validateSteps(steps: any, targetContext: any, result: ValidationResult): void {
    if (!steps || typeof steps !== 'object') {
      return;
    }

    const stepKeys = Object.keys(steps);
    result.summary.totalSteps = stepKeys.length;

    stepKeys.forEach(containerKey => {
      const containerSteps = steps[containerKey];
      
      if (!containerSteps || typeof containerSteps !== 'object') {
        result.warnings.push({
          type: 'warning',
          message: `El contenedor ${containerKey} no tiene steps definidos`,
          container: containerKey
        });
        return;
      }

      // Validar que el contenedor existe en targetContext
      const baseKey = containerKey.split('::')[0];
      if (targetContext && !targetContext[containerKey] && !targetContext[baseKey]) {
        result.warnings.push({
          type: 'warning',
          message: `El contenedor ${containerKey} tiene steps pero no existe en targetContext`,
          container: containerKey
        });
      }

      // Validar cada step del contenedor
      Object.keys(containerSteps).forEach(stepKey => {
        const step = containerSteps[stepKey];
        result.summary.totalControls++;

        // Validar que el step tiene action
        if (!step.action) {
          result.errors.push({
            type: 'error',
            message: `El step ${stepKey} en ${containerKey} no tiene acción definida`,
            step: stepKey,
            container: containerKey
          });
        } else if (!this.allowedActions.includes(step.action)) {
          result.warnings.push({
            type: 'warning',
            message: `El step ${stepKey} en ${containerKey} tiene una acción no reconocida: ${step.action}`,
            step: stepKey,
            container: containerKey
          });
        }

        // Validar que tiene target (excepto para algunas acciones especiales)
        if (!step.target && !['reset', 'exit'].includes(step.action)) {
          result.warnings.push({
            type: 'warning',
            message: `El step ${stepKey} en ${containerKey} no tiene target definido`,
            step: stepKey,
            container: containerKey
          });
        }
      });
    });
  }

  /**
   * Valida referencias entre steps (next)
   */
  private validateStepReferences(steps: any, targetContext: any, result: ValidationResult): void {
    if (!steps || typeof steps !== 'object') {
      return;
    }

    const allStepKeys = new Map<string, string>(); // stepKey -> containerKey

    // Primero, mapear todos los steps disponibles
    Object.keys(steps).forEach(containerKey => {
      const containerSteps = steps[containerKey];
      if (containerSteps && typeof containerSteps === 'object') {
        Object.keys(containerSteps).forEach(stepKey => {
          allStepKeys.set(stepKey, containerKey);
        });
      }
    });

    // Validar referencias next
    Object.keys(steps).forEach(containerKey => {
      const containerSteps = steps[containerKey];
      if (!containerSteps || typeof containerSteps !== 'object') return;

      Object.keys(containerSteps).forEach(stepKey => {
        const step = containerSteps[stepKey];
        
        if (step.next) {
          // El next puede ser:
          // 1. Un stepKey simple: "nextStep"
          // 2. Un stepKey con contenedor: "ContainerKey.stepKey"
          // 3. Un stepKey con contenedor e instancia: "ContainerKey::2.stepKey"
          
          const nextParts = step.next.split('.');
          const nextContainerKey = nextParts.length > 1 ? nextParts[0] : containerKey;
          const nextStepKey = nextParts.length > 1 ? nextParts.slice(1).join('.') : step.next;

          // Verificar si el step referenciado existe
          const referencedContainer = steps[nextContainerKey];
          if (!referencedContainer) {
            result.errors.push({
              type: 'error',
              message: `El step ${stepKey} en ${containerKey} referencia un contenedor inexistente: ${nextContainerKey}`,
              step: stepKey,
              container: containerKey
            });
          } else if (referencedContainer[nextStepKey]) {
            // El step existe, validación OK
          } else {
            // Verificar si es una referencia a un contenedor completo (sin step específico)
            // Esto es válido en algunos casos, pero generamos un warning
            result.warnings.push({
              type: 'warning',
              message: `El step ${stepKey} en ${containerKey} referencia un step que podría no existir: ${step.next}`,
              step: stepKey,
              container: containerKey
            });
          }
        }
      });
    });
  }

  /**
   * Valida conexiones entre contenedores
   */
  private validateContainerConnections(steps: any, result: ValidationResult): void {
    if (!steps || typeof steps !== 'object') {
      return;
    }

    const containers = Object.keys(steps);
    const connections = new Map<string, Set<string>>(); // container -> set of connected containers

    // Mapear conexiones
    containers.forEach(containerKey => {
      const containerSteps = steps[containerKey];
      if (!containerSteps || typeof containerSteps !== 'object') return;

      Object.values(containerSteps).forEach((step: any) => {
        if (step.next) {
          const nextParts = step.next.split('.');
          const nextContainerKey = nextParts.length > 1 ? nextParts[0] : containerKey;
          
          if (nextContainerKey !== containerKey && containers.includes(nextContainerKey)) {
            if (!connections.has(containerKey)) {
              connections.set(containerKey, new Set());
            }
            connections.get(containerKey)!.add(nextContainerKey);
          }
        }
      });
    });

    // Verificar contenedores sin conexiones salientes
    containers.forEach(containerKey => {
      const hasOutgoing = connections.has(containerKey) && connections.get(containerKey)!.size > 0;
      const hasIncoming = Array.from(connections.values()).some(connected => connected.has(containerKey));
      
      if (!hasOutgoing && !hasIncoming && containers.length > 1) {
        result.warnings.push({
          type: 'warning',
          message: `El contenedor ${containerKey} no tiene conexiones con otros contenedores`,
          container: containerKey
        });
        result.summary.missingConnections++;
      }
    });
  }

  /**
   * Valida nombres duplicados
   */
  private validateDuplicateNames(flowData: any, result: ValidationResult): void {
    if (!flowData.steps || typeof flowData.steps !== 'object') {
      return;
    }

    const stepNames = new Map<string, string[]>(); // stepName -> [containerKeys]

    Object.keys(flowData.steps).forEach(containerKey => {
      const containerSteps = flowData.steps[containerKey];
      if (!containerSteps || typeof containerSteps !== 'object') return;

      Object.keys(containerSteps).forEach(stepKey => {
        if (!stepNames.has(stepKey)) {
          stepNames.set(stepKey, []);
        }
        stepNames.get(stepKey)!.push(containerKey);
      });
    });

    // Verificar duplicados (mismo nombre de step en diferentes contenedores puede ser válido)
    // Pero si es en el mismo contenedor, es un error
    stepNames.forEach((containerKeys, stepKey) => {
      const uniqueContainers = new Set(containerKeys);
      if (uniqueContainers.size < containerKeys.length) {
        result.errors.push({
          type: 'error',
          message: `El step ${stepKey} está duplicado en el mismo contenedor`,
          step: stepKey,
          container: containerKeys[0]
        });
        result.summary.duplicateNames++;
      }
    });
  }

  /**
   * Valida un JSON antes de guardar
   */
  validateJsonBeforeSave(jsonContent: string): ValidationResult {
    try {
      const flowData = JSON.parse(jsonContent);
      return this.validateFlow(flowData);
    } catch (error) {
      return {
        isValid: false,
        errors: [{
          type: 'error',
          message: `Error al parsear JSON: ${error instanceof Error ? error.message : 'Error desconocido'}`
        }],
        warnings: [],
        info: [],
        summary: {
          totalContainers: 0,
          totalSteps: 0,
          totalControls: 0,
          missingConnections: 0,
          duplicateNames: 0
        }
      };
    }
  }
}




