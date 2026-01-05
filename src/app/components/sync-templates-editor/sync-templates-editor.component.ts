import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SftpService, SftpFile } from '../../services/sftp.service';
import { TemplateValidatorService, TemplateValidationResult } from '../../services/template-validator.service';

interface TemplateForm {
  id: string;
  tcode: string;
  customName: string;
  jsonData: any;
  parameters: string[];
  defaultValues: { [key: string]: any };
}

interface SyncTemplate {
  id: string;
  name: string;
  type: 'SUMMARY_SYNC' | 'DETAILS_SYNC' | 'CUSTOM';
  forms: TemplateForm[];
}

@Component({
  selector: 'app-sync-templates-editor',
  templateUrl: './sync-templates-editor.component.html',
  styleUrls: ['./sync-templates-editor.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class SyncTemplatesEditorComponent implements OnInit {
  // Directorio donde se guardan las plantillas editadas
  // Ubicación: ~/lek-files-dev/can/sap-config/sap-query-package
  // IMPORTANTE: Este es el directorio para PLANTILLAS (templates), NO para paquetes de sincronización
  private readonly TEMPLATES_DIRECTORY = 'sap-query-package';
  
  // Directorio donde están los flujos base
  // Ubicación: ~/lek-files-dev/can/sap-config/sap-gui-flow
  // NOTA: El backend debe mapear 'sap-gui-flow' a ~/lek-files-dev/can/sap-config/sap-gui-flow
  private readonly FLOWS_DIRECTORY = 'sap-gui-flow';
  
  templates: SyncTemplate[] = [];
  currentTemplateId: string | null = null;
  currentFormId: string | null = null;
  templateIdCounter = 0;
  formIdCounter = 0;
  formDataCache: { [key: string]: any } = {};
  loadingTemplates = false;
  availableFlows: SftpFile[] = [];
  loadingFlows = false;
  
  // Modal para crear nueva plantilla
  showCreateTemplateModal = false;
  selectedTemplateType: 'SUMMARY_SYNC' | 'DETAILS_SYNC' | 'CUSTOM' | null = null;
  customTemplateName: string = '';
  selectedFlowsForTemplate: Set<string> = new Set();
  showFlowSelector = false;
  selectedPackageIdForFile: string | null = null; // Para agregar flujos a una plantilla existente
  
  // Variables para panel de validación y vista previa
  showValidationPanel: boolean = false;
  validationResult: TemplateValidationResult | null = null;
  showPreviewPanel: boolean = false;
  previewData: any = null;
  previewDateRange: { startDate: string; endDate?: string; periodType: 'month' | 'day' } | null = null;
  showComparisonPanel: boolean = false;
  templateHistory: Map<string, SyncTemplate[]> = new Map(); // templateId -> [versions]
  comparisonResult: { differences: string[]; addedForms: string[]; removedForms: string[]; modifiedForms: string[] } | null = null;
  
  constructor(
    private sftpService: SftpService,
    private templateValidator: TemplateValidatorService
  ) {}

  ngOnInit(): void {
    this.loadTemplatesFromSftp();
    this.loadFlowsFromSftp();
  }

  /**
   * Carga las plantillas guardadas desde SFTP
   */
  loadTemplatesFromSftp(): void {
    this.loadingTemplates = true;
    console.log('Cargando plantillas desde directorio:', this.TEMPLATES_DIRECTORY);
    
    this.sftpService.listPackages(this.TEMPLATES_DIRECTORY).subscribe({
      next: (response) => {
        console.log('Respuesta completa del servidor:', response);
        this.loadingTemplates = false;
        
        if (!response) {
          console.error('Respuesta del servidor es null o undefined');
          alert('Error: No se recibió respuesta del servidor');
          return;
        }
        
        if (!response.status) {
          console.error('El servidor retornó status=false:', response.message);
          alert(`Error del servidor: ${response.message || 'No se pudieron cargar las plantillas'}`);
          return;
        }
        
        if (!response.files || !Array.isArray(response.files)) {
          console.error('response.files no es un array válido:', response.files);
          alert('Error: El servidor no retornó una lista válida de archivos');
          return;
        }
        
        console.log(`✓ Se encontraron ${response.files.length} archivos en el directorio ${this.TEMPLATES_DIRECTORY}`);
        console.log('Archivos encontrados:', response.files.map(f => ({ name: f.name, path: f.path, isDirectory: f.isDirectory })));
        
        // Cargar todos los archivos JSON (no solo los que tienen SUMMARY_SYNC o DETAILS_SYNC en el nombre)
        const templateFiles = response.files.filter(f => 
          f.name.endsWith('.json') && !f.isDirectory
        );
        
        console.log(`✓ Se cargarán ${templateFiles.length} archivos JSON como plantillas:`, templateFiles.map(f => f.name));
        
        if (templateFiles.length === 0) {
          console.warn('⚠ No se encontraron archivos JSON en el directorio de plantillas');
          console.warn('Archivos en el directorio:', response.files.map(f => f.name));
          return;
        }
        
        // Cargar cada archivo secuencialmente para evitar problemas de concurrencia
        let loadedCount = 0;
        templateFiles.forEach((file, index) => {
          console.log(`[${index + 1}/${templateFiles.length}] Cargando plantilla: ${file.name} desde ${file.path}`);
          setTimeout(() => {
            this.loadTemplateFromFile(file);
            loadedCount++;
            if (loadedCount === templateFiles.length) {
              console.log(`✓ Todas las plantillas procesadas (${loadedCount}/${templateFiles.length})`);
            }
          }, index * 100); // Pequeño delay para evitar sobrecarga
        });
      },
      error: (error) => {
        console.error('❌ Error al cargar plantillas:', error);
        console.error('Detalles del error:', {
          message: error.message,
          status: error.status,
          error: error.error,
          url: error.url
        });
        this.loadingTemplates = false;
        alert(`Error al cargar plantillas: ${error.message || error}\n\nVerifique la consola para más detalles.`);
      }
    });
  }

  /**
   * Carga un archivo de plantilla específico
   */
  loadTemplateFromFile(file: SftpFile): void {
    console.log(`📄 Cargando contenido de: ${file.name} desde ${file.path}`);
    
    this.sftpService.getJsonFileContent(file.path).subscribe({
      next: (response) => {
        console.log(`📥 Respuesta para ${file.name}:`, {
          status: response.status,
          hasContent: !!response.content,
          contentLength: response.content?.length || 0,
          fileName: response.fileName
        });
        
        if (!response) {
          console.error(`❌ Respuesta null para ${file.name}`);
          return;
        }
        
        if (!response.status) {
          console.error(`❌ El servidor retornó status=false para ${file.name}:`, response.message);
          return;
        }
        
        if (!response.content) {
          console.error(`❌ No se recibió contenido para ${file.name}`);
          return;
        }
        
        try {
          const templateData = JSON.parse(response.content);
          console.log(`✓ JSON parseado exitosamente para ${file.name}`);
          console.log(`📊 Estructura de ${file.name}:`, {
            keys: Object.keys(templateData),
            firstKeyType: Object.keys(templateData).length > 0 ? typeof templateData[Object.keys(templateData)[0]] : 'N/A',
            isArray: Array.isArray(templateData)
          });
          
          const templateId = `template_${this.templateIdCounter++}`;
          const forms: TemplateForm[] = [];
          
          // El archivo puede tener dos estructuras:
          // 1. Un objeto donde cada clave es un formulario (formName: { tcode, ... })
          // 2. Un objeto plano con propiedades directamente
          
          const keys = Object.keys(templateData);
          console.log(`🔑 Claves encontradas en ${file.name} (${keys.length}):`, keys.slice(0, 10)); // Mostrar solo las primeras 10
          
          // Si el objeto tiene una estructura de formularios (cada clave es un formulario)
          if (keys.length > 0 && typeof templateData[keys[0]] === 'object' && templateData[keys[0]] !== null && !Array.isArray(templateData[keys[0]])) {
            console.log(`📋 Estructura de múltiples formularios detectada en ${file.name}`);
            // Estructura: { FormName1: { tcode, ... }, FormName2: { tcode, ... } }
            Object.keys(templateData).forEach((formName) => {
              const formData = templateData[formName];
              
              // Verificar que formData es un objeto válido
              if (typeof formData === 'object' && formData !== null && !Array.isArray(formData)) {
                const formId = `form_${this.formIdCounter++}`;
                
                // Extraer parámetros (todas las claves excepto tcode y jsonData)
                const parameters = Object.keys(formData).filter(key => 
                  key !== 'tcode' && key !== 'jsonData'
                );
                
                const form: TemplateForm = {
                  id: formId,
                  tcode: formData.tcode || '',
                  customName: formName,
                  jsonData: formData.jsonData || {},
                  parameters: parameters,
                  defaultValues: { ...formData }
                };
                
                forms.push(form);
                this.formDataCache[formId] = { ...formData };
                console.log(`  ✓ Formulario creado: ${formName} con ${parameters.length} parámetros`);
              } else {
                console.warn(`  ⚠ FormData para ${formName} no es un objeto válido:`, typeof formData);
              }
            });
          } else {
            console.log(`📄 Estructura plana detectada en ${file.name} - tratando como formulario único`);
            // Estructura plana: el objeto completo es un solo formulario
            const formId = `form_${this.formIdCounter++}`;
            const parameters = Object.keys(templateData).filter(key => 
              key !== 'tcode' && key !== 'jsonData'
            );
            
            const form: TemplateForm = {
              id: formId,
              tcode: templateData.tcode || '',
              customName: file.name.replace('.json', ''),
              jsonData: templateData.jsonData || {},
              parameters: parameters,
              defaultValues: { ...templateData }
            };
            
            forms.push(form);
            this.formDataCache[formId] = { ...templateData };
            console.log(`  ✓ Formulario único creado desde ${file.name} con ${parameters.length} parámetros`);
          }
          
          if (forms.length === 0) {
            console.error(`❌ No se pudieron crear formularios desde ${file.name}`);
            console.error(`   Estructura del archivo:`, templateData);
            return;
          }
          
          // Determinar el tipo de plantilla basándose en el nombre del archivo o el contenido
          let templateType: 'SUMMARY_SYNC' | 'DETAILS_SYNC' | 'CUSTOM' = 'DETAILS_SYNC';
          const fileNameUpper = file.name.toUpperCase();
          if (fileNameUpper.includes('SUMMARY') || fileNameUpper.includes('ZFIR') || fileNameUpper.includes('STATSLOAD')) {
            templateType = 'SUMMARY_SYNC';
          } else if (!fileNameUpper.includes('DETAILS') && !fileNameUpper.includes('SUMMARY')) {
            // Si no es SUMMARY ni DETAILS, es una plantilla personalizada
            templateType = 'CUSTOM';
          } else if (fileNameUpper.includes('DETAILS') || forms.length > 1) {
            templateType = 'DETAILS_SYNC';
          }
          
          const template: SyncTemplate = {
            id: templateId,
            name: file.name.replace('.json', ''),
            type: templateType,
            forms: forms
          };
          
          this.templates.push(template);
          console.log(`✅ Plantilla "${template.name}" cargada exitosamente con ${forms.length} formulario(s) de tipo ${templateType}`);
        } catch (error: any) {
          console.error(`❌ Error al parsear plantilla ${file.name}:`, error);
          console.error(`   Mensaje:`, error.message);
          console.error(`   Stack:`, error.stack);
          console.error(`   Contenido del archivo (primeros 500 caracteres):`, response.content?.substring(0, 500));
        }
      },
      error: (error) => {
        console.error(`❌ Error al cargar plantilla ${file.name}:`, error);
        console.error(`   Detalles:`, {
          message: error.message,
          status: error.status,
          error: error.error,
          url: error.url
        });
      }
    });
  }

  /**
   * Carga los flujos base desde SFTP
   * Usa listFlows() que apunta al directorio correcto de flujos
   */
  loadFlowsFromSftp(): void {
    this.loadingFlows = true;
    console.log('Cargando flujos base desde SFTP...');
    console.log('Directorio esperado: ~/lek-files-dev/can/sap-config/sap-gui-flow$');
    
    // Usar listFlows() que apunta directamente al directorio de flujos
    this.sftpService.listFlows().subscribe({
      next: (response) => {
        console.log('Respuesta de listFlows():', response);
        if (response.status && response.files && response.files.length > 0) {
          this.availableFlows = response.files.filter(f => 
            f.name.endsWith('.json') && 
            !f.isDirectory
          );
          console.log(`✓ Se encontraron ${this.availableFlows.length} flujos base usando listFlows():`, this.availableFlows.map(f => f.name));
          this.loadingFlows = false;
        } else {
          console.warn('No se encontraron archivos con listFlows()');
          this.availableFlows = [];
          this.loadingFlows = false;
        }
      },
      error: (error) => {
        console.error('Error al cargar flujos con listFlows():', error);
        this.availableFlows = [];
        this.loadingFlows = false;
      }
    });
  }

  /**
   * Intenta cargar flujos usando listFlows() y listJsonFiles() como respaldo
   */
  private tryListFlows(): void {
    this.sftpService.listFlows().subscribe({
      next: (flowsResponse) => {
        console.log('Respuesta de listFlows():', flowsResponse);
        if (flowsResponse.status && flowsResponse.files && flowsResponse.files.length > 0) {
          this.availableFlows = flowsResponse.files.filter(f => 
            f.name.endsWith('.json') && 
            !f.isDirectory
          );
          console.log(`✓ Se encontraron ${this.availableFlows.length} flujos base usando listFlows():`, this.availableFlows.map(f => f.name));
          this.loadingFlows = false;
        } else {
          console.warn('No se encontraron archivos con listFlows, intentando con listJsonFiles()...');
          // Intentar con listJsonFiles() como último recurso
          this.tryListJsonFiles();
        }
      },
      error: (flowsError) => {
        console.error('Error al cargar flujos con listFlows():', flowsError);
        // Intentar con listJsonFiles() como último recurso
        this.tryListJsonFiles();
      }
    });
  }

  /**
   * Intenta cargar flujos usando listJsonFiles() como último recurso
   */
  private tryListJsonFiles(): void {
    this.sftpService.listJsonFiles().subscribe({
      next: (jsonResponse) => {
        console.log('Respuesta de listJsonFiles():', jsonResponse);
        if (jsonResponse.status && jsonResponse.files) {
          this.availableFlows = jsonResponse.files.filter(f => 
            f.name.endsWith('.json') && 
            !f.isDirectory
          );
          console.log(`✓ Se encontraron ${this.availableFlows.length} flujos base usando listJsonFiles():`, this.availableFlows.map(f => f.name));
        } else {
          console.error('No se encontraron archivos en ningún método. Verifique la configuración del backend.');
          alert('No se pudieron cargar los flujos base. Verifique la configuración del backend y que el directorio ~/lek-files-dev/can/sap-config/sap-gui-flow exista.');
        }
        this.loadingFlows = false;
      },
      error: (jsonError) => {
        console.error('Error al cargar flujos con listJsonFiles():', jsonError);
        this.loadingFlows = false;
        alert('Error al cargar los flujos base. Verifique la conexión con el servidor SFTP.');
      }
    });
  }

  /**
   * Abre el modal para crear una nueva plantilla
   */
  openCreateTemplateModal(): void {
    this.showCreateTemplateModal = true;
  }

  /**
   * Crea una nueva plantilla desde los flujos base
   */
  createTemplateFromFlows(): void {
    if (!this.selectedTemplateType) {
      return;
    }

    if (this.selectedTemplateType === 'SUMMARY_SYNC') {
      this.createSummarySyncTemplate();
      this.showCreateTemplateModal = false;
      this.selectedTemplateType = null;
    } else if (this.selectedTemplateType === 'DETAILS_SYNC') {
      this.createDetailsSyncTemplate();
      this.showCreateTemplateModal = false;
      this.selectedTemplateType = null;
    } else if (this.selectedTemplateType === 'CUSTOM') {
      // Si es personalizada, mostrar el selector de flujos
      if (!this.showFlowSelector) {
        this.showFlowSelector = true;
        return;
      }
      // Si ya estamos en el selector de flujos, crear/agregar la plantilla
      this.createCustomTemplate();
    }
  }

  /**
   * Alterna la selección de un flujo para la plantilla personalizada
   */
  toggleFlowSelection(flowPath: string): void {
    if (this.selectedFlowsForTemplate.has(flowPath)) {
      this.selectedFlowsForTemplate.delete(flowPath);
    } else {
      this.selectedFlowsForTemplate.add(flowPath);
    }
  }

  /**
   * Verifica si un flujo está seleccionado
   */
  isFlowSelected(flowPath: string): boolean {
    return this.selectedFlowsForTemplate.has(flowPath);
  }

  /**
   * Crea una plantilla personalizada con los flujos seleccionados o agrega flujos a una existente
   */
  createCustomTemplate(): void {
    // Si estamos agregando flujos a una plantilla existente
    if (this.selectedPackageIdForFile) {
      const existingTemplate = this.templates.find(t => t.id === this.selectedPackageIdForFile);
      if (!existingTemplate) {
        alert('Error: No se encontró la plantilla.');
        this.resetModalState();
        return;
      }

      if (this.selectedFlowsForTemplate.size === 0) {
        alert('Por favor, seleccione al menos un flujo para agregar.');
        return;
      }

      const flowsToLoad = Array.from(this.selectedFlowsForTemplate);
      let loadedCount = 0;
      const totalFlows = flowsToLoad.length;

      flowsToLoad.forEach((flowPath) => {
        const flow = this.availableFlows.find(f => f.path === flowPath);
        if (!flow) {
          loadedCount++;
          if (loadedCount === totalFlows) {
            this.resetModalState();
          }
          return;
        }

        this.sftpService.getJsonFileContent(flowPath).subscribe({
          next: (response) => {
            loadedCount++;
            if (response.status && response.content) {
              try {
                const jsonData = JSON.parse(response.content);
                
                if (!jsonData.$meta || !jsonData.$meta.tcode) {
                  console.error(`El flujo ${flow.name} no contiene $meta.tcode`);
                  if (loadedCount === totalFlows) {
                    this.resetModalState();
                  }
                  return;
                }

                const tcode = jsonData.$meta.tcode;
                const customName = flow.name.replace('.json', '');
                
                // Verificar si el flujo ya existe en la plantilla
                const existingForm = existingTemplate.forms.find(f => f.customName === customName);
                if (existingForm) {
                  alert(`El flujo "${customName}" ya existe en esta plantilla.`);
                  if (loadedCount === totalFlows) {
                    this.resetModalState();
                  }
                  return;
                }
                
                // Extraer parámetros del flujo
                const parameters = this.extractParametersFromFlow(jsonData);
                
                const formId = `form_${this.formIdCounter++}`;
                const templateForm: TemplateForm = {
                  id: formId,
                  tcode: tcode,
                  customName: customName,
                  jsonData: jsonData,
                  parameters: parameters,
                  defaultValues: {}
                };

                existingTemplate.forms.push(templateForm);

                if (loadedCount === totalFlows) {
                  alert(`Se agregaron ${totalFlows} flujo(s) a la plantilla "${existingTemplate.name}".`);
                  this.resetModalState();
                }
              } catch (error) {
                console.error(`Error al procesar flujo ${flow.name}:`, error);
                if (loadedCount === totalFlows) {
                  this.resetModalState();
                }
              }
            } else {
              console.error(`Error al cargar flujo ${flow.name}:`, response.message);
              if (loadedCount === totalFlows) {
                this.resetModalState();
              }
            }
          },
          error: (error) => {
            loadedCount++;
            console.error(`Error al cargar flujo ${flowPath}:`, error);
            if (loadedCount === totalFlows) {
              this.resetModalState();
            }
          }
        });
      });
      return;
    }

    // Crear nueva plantilla
    if (!this.customTemplateName || this.customTemplateName.trim() === '') {
      alert('Por favor, ingrese un nombre para la plantilla personalizada.');
      return;
    }

    if (this.selectedFlowsForTemplate.size === 0) {
      alert('Por favor, seleccione al menos un flujo para la plantilla.');
      return;
    }

    const templateId = `template_${this.templateIdCounter++}`;
    const forms: TemplateForm[] = [];
    const flowsToLoad = Array.from(this.selectedFlowsForTemplate);
    let loadedCount = 0;
    const totalFlows = flowsToLoad.length;

    flowsToLoad.forEach((flowPath) => {
      const flow = this.availableFlows.find(f => f.path === flowPath);
      if (!flow) {
        loadedCount++;
        if (loadedCount === totalFlows) {
          this.finishCustomTemplateCreation(templateId, forms, this.customTemplateName);
        }
        return;
      }

      this.sftpService.getJsonFileContent(flowPath).subscribe({
        next: (response) => {
          loadedCount++;
          if (response.status && response.content) {
            try {
              const jsonData = JSON.parse(response.content);
              
              if (!jsonData.$meta || !jsonData.$meta.tcode) {
                console.error(`El flujo ${flow.name} no contiene $meta.tcode`);
                if (loadedCount === totalFlows) {
                  this.finishCustomTemplateCreation(templateId, forms, this.customTemplateName);
                }
                return;
              }

              const tcode = jsonData.$meta.tcode;
              const customName = flow.name.replace('.json', '');
              
              // Extraer parámetros del flujo
              const parameters = this.extractParametersFromFlow(jsonData);
              
              const formId = `form_${this.formIdCounter++}`;
              const templateForm: TemplateForm = {
                id: formId,
                tcode: tcode,
                customName: customName,
                jsonData: jsonData,
                parameters: parameters,
                defaultValues: {}
              };

              forms.push(templateForm);

              if (loadedCount === totalFlows) {
                this.finishCustomTemplateCreation(templateId, forms, this.customTemplateName);
              }
            } catch (error) {
              console.error(`Error al procesar flujo ${flow.name}:`, error);
              if (loadedCount === totalFlows) {
                this.finishCustomTemplateCreation(templateId, forms, this.customTemplateName);
              }
            }
          } else {
            console.error(`Error al cargar flujo ${flow.name}:`, response.message);
            if (loadedCount === totalFlows) {
              this.finishCustomTemplateCreation(templateId, forms, this.customTemplateName);
            }
          }
        },
        error: (error) => {
          loadedCount++;
          console.error(`Error al cargar flujo ${flowPath}:`, error);
              if (loadedCount === totalFlows) {
                this.finishCustomTemplateCreation(templateId, forms, this.customTemplateName);
              }
            }
          });
        });
      }

  /**
   * Finaliza la creación de la plantilla personalizada
   */
  private finishCustomTemplateCreation(templateId: string, forms: TemplateForm[], templateName: string): void {
    if (forms.length === 0) {
      alert('No se pudieron cargar los flujos seleccionados. Por favor, intente nuevamente.');
      this.resetModalState();
      return;
    }

    const newTemplate: SyncTemplate = {
      id: templateId,
      name: templateName.trim(),
      type: 'CUSTOM',
      forms: forms
    };

    this.templates.push(newTemplate);
    this.selectTemplate(templateId);
    alert(`Plantilla "${templateName}" creada exitosamente con ${forms.length} formulario(s).`);
    this.resetModalState();
  }

  /**
   * Resetea el estado del modal
   */
  resetModalState(): void {
    this.showCreateTemplateModal = false;
    this.selectedTemplateType = null;
    this.customTemplateName = '';
    this.selectedFlowsForTemplate.clear();
    this.showFlowSelector = false;
    this.selectedPackageIdForFile = null;
  }

  /**
   * Extrae los parámetros de un flujo
   */
  private extractParametersFromFlow(flowData: any): string[] {
    const params = new Set<string>();
    
    if (!flowData.steps) {
      return [];
    }

    Object.keys(flowData.steps).forEach(stepKey => {
      const step = flowData.steps[stepKey];
      
      if (typeof step === 'object' && step !== null) {
        Object.keys(step).forEach(actionKey => {
          const action = step[actionKey];
          if (action && action.action === 'set') {
            // Prioridad 1: usar paramKey si existe (puede tener múltiples opciones separadas por |)
            if (action.paramKey) {
              const paramKeys = action.paramKey.split('|').map((p: string) => p.trim());
              paramKeys.forEach((param: string) => {
                if (param) {
                  params.add(param);
                }
              });
            }
            // Prioridad 2: usar target como fallback si no hay paramKey
            else if (action.target) {
              // El target puede ser el nombre del control (ej: "CostCenterHigh")
              // Solo agregar si no parece ser un path de SAP (no empieza con /app)
              if (!action.target.startsWith('/app')) {
                params.add(action.target);
              }
            }
          }
        });
      }
    });

    // Agregar Columns y NoSum si no están presentes
    if (!params.has('Columns')) {
      params.add('Columns');
    }
    if (!params.has('NoSum')) {
      params.add('NoSum');
    }

    return Array.from(params);
  }

  /**
   * Crea una plantilla SUMMARY_SYNC desde el flujo ZFIR_STATSLOAD
   */
  createSummarySyncTemplate(): void {
    // Si los flujos no están cargados o están cargando, esperar
    if (this.loadingFlows) {
      console.log('Los flujos se están cargando, esperando...');
      setTimeout(() => {
        this.createSummarySyncTemplate();
      }, 500);
      return;
    }

    if (this.availableFlows.length === 0) {
      console.log('Los flujos no están cargados, cargando...');
      this.loadFlowsFromSftp();
      
      // Esperar a que se carguen los flujos y luego intentar de nuevo
      setTimeout(() => {
        this.createSummarySyncTemplate();
      }, 1500);
      return;
    }

    // Buscar el archivo de manera más específica
    console.log('Buscando ZFIR_STATSLOAD en flujos disponibles:', this.availableFlows.map(f => f.name));
    const zfirFile = this.availableFlows.find(f => {
      const fileName = f.name.toLowerCase();
      return fileName === 'zfir_statsload.json' || 
             fileName === 'zfir_statsload' ||
             (fileName.includes('zfir') && fileName.includes('statsload'));
    });

    if (!zfirFile) {
      console.error('No se encontró el archivo zfir_statsload.json');
      console.error('Flujos disponibles:', this.availableFlows.map(f => f.name));
      const availableNames = this.availableFlows.map(f => f.name).join(', ');
      alert(`No se encontró el flujo ZFIR_STATSLOAD.\n\nFlujos disponibles (${this.availableFlows.length}):\n${availableNames}\n\nVerifique que el archivo "zfir_statsload.json" exista en el directorio de flujos.`);
      return;
    }
    
    console.log('✓ Archivo ZFIR_STATSLOAD encontrado:', zfirFile.name, 'en ruta:', zfirFile.path);

    this.sftpService.getJsonFileContent(zfirFile.path).subscribe({
      next: (response) => {
        if (response.status && response.content) {
          try {
            const jsonData = JSON.parse(response.content);
            const templateId = `template_${this.templateIdCounter++}`;
            const formId = `form_${this.formIdCounter++}`;
            
            const parameters = this.extractParameters(jsonData);
            const defaultValues = this.getSummarySyncDefaults(parameters);
            
            const form: TemplateForm = {
              id: formId,
              tcode: 'ZFIR_STATSLOAD',
              customName: 'ZFIR_STATSLOAD',
              jsonData: jsonData,
              parameters: parameters,
              defaultValues: defaultValues
            };
            
            const template: SyncTemplate = {
              id: templateId,
              name: 'SUMMARY_SYNC',
              type: 'SUMMARY_SYNC',
              forms: [form]
            };
            
            this.templates.push(template);
            this.formDataCache[formId] = { ...defaultValues };
            this.selectTemplate(templateId);
          } catch (error) {
            console.error('Error al crear plantilla SUMMARY_SYNC:', error);
            alert('Error al crear la plantilla');
          }
        }
      },
      error: (error) => {
        console.error('Error al cargar flujo ZFIR_STATSLOAD:', error);
        alert('Error al cargar el flujo base');
      }
    });
  }

  /**
   * Crea una plantilla DETAILS_SYNC desde los flujos KSB1, KOB1, CJI3
   */
  createDetailsSyncTemplate(): void {
    const tcodes = [
      { tcode: 'KSB1', customName: 'KSB1' },
      { tcode: 'KOB1', customName: 'KOB1' },
      { tcode: 'CJI3', customName: 'CJI3_ALLCOST' },
      { tcode: 'CJI3', customName: 'CJI3_CANDALL' }
    ];

    const templateId = `template_${this.templateIdCounter++}`;
    const forms: TemplateForm[] = [];
    let filesLoaded = 0;
    const totalFiles = tcodes.length;

    tcodes.forEach(tcodeInfo => {
      const flowFile = this.availableFlows.find(f => 
        f.name.toLowerCase() === `${tcodeInfo.tcode.toLowerCase()}.json`
      );

      if (flowFile) {
        this.sftpService.getJsonFileContent(flowFile.path).subscribe({
          next: (response) => {
            if (response.status && response.content) {
              try {
                const jsonData = JSON.parse(response.content);
                const formId = `form_${this.formIdCounter++}`;
                const parameters = this.extractParameters(jsonData);
                
                let defaultValues: any;
                if (tcodeInfo.tcode === 'KSB1') {
                  defaultValues = this.getKSB1Defaults(parameters);
                } else if (tcodeInfo.tcode === 'KOB1') {
                  defaultValues = this.getKOB1Defaults(parameters);
                } else {
                  defaultValues = this.getCJI3Defaults(parameters, tcodeInfo.customName);
                }
                
                const form: TemplateForm = {
                  id: formId,
                  tcode: tcodeInfo.tcode,
                  customName: tcodeInfo.customName,
                  jsonData: jsonData,
                  parameters: parameters,
                  defaultValues: defaultValues
                };
                
                forms.push(form);
                this.formDataCache[formId] = { ...defaultValues };
                filesLoaded++;
                
                if (filesLoaded === totalFiles) {
                  const template: SyncTemplate = {
                    id: templateId,
                    name: 'DETAILS_SYNC',
                    type: 'DETAILS_SYNC',
                    forms: forms
                  };
                  
                  this.templates.push(template);
                  this.selectTemplate(templateId);
                }
              } catch (error) {
                console.error(`Error al procesar ${tcodeInfo.tcode}:`, error);
                filesLoaded++;
              }
            }
          },
          error: (error) => {
            console.error(`Error al cargar ${tcodeInfo.tcode}:`, error);
            filesLoaded++;
          }
        });
      } else {
        console.warn(`No se encontró el flujo ${tcodeInfo.tcode}`);
        filesLoaded++;
      }
    });
  }

  /**
   * Extrae los parámetros de un flujo JSON
   */
  extractParameters(data: any): string[] {
    const params = new Set<string>();
    
    if (!data.steps) {
      return [];
    }

    Object.keys(data.steps).forEach(stepKey => {
      const step = data.steps[stepKey];
      
      if (typeof step === 'object' && step !== null) {
        Object.keys(step).forEach(actionKey => {
          const action = step[actionKey];
          if (action && action.action === 'set' && action.target) {
            params.add(action.target);
          }
        });
      }
    });

    const parameters = Array.from(params);
    
    // Agregar Columns y NoSum si no están presentes
    if (!params.has('Columns')) {
      parameters.push('Columns');
    }
    if (!params.has('NoSum')) {
      parameters.push('NoSum');
    }
    
    return parameters;
  }

  /**
   * Obtiene los valores por defecto para SUMMARY_SYNC
   */
  getSummarySyncDefaults(parameters: string[]): any {
    const defaults: any = {};
    
    parameters.forEach(param => {
      const paramLower = param.toLowerCase();
      
      // Controlling Area Low: "2000"
      if (paramLower.includes('controlling') && paramLower.includes('area') && paramLower.includes('low')) {
        defaults[param] = '2000';
      }
      // Company Code LOW: "2000"
      else if (paramLower.includes('company') && paramLower.includes('code') && paramLower.includes('low') && !paramLower.includes('high')) {
        defaults[param] = '2000';
      }
      // Company Code HIGH: "2100"
      else if (paramLower.includes('company') && paramLower.includes('code') && paramLower.includes('high')) {
        defaults[param] = '2100';
      }
      // Profit Center: "2000"
      else if (paramLower.includes('profit') && paramLower.includes('center') && !paramLower.includes('category')) {
        defaults[param] = '2000';
      }
      // Cost Element Group Low: "CE_STD"
      else if (paramLower.includes('cost') && paramLower.includes('element') && paramLower.includes('group') && paramLower.includes('low')) {
        defaults[param] = 'CE_STD';
      }
      // NoSum: true (para SUMMARY_SYNC es boolean, no array)
      else if (param === 'NoSum') {
        defaults[param] = true;
      }
      // Columns: true (para SUMMARY_SYNC es boolean, no array)
      else if (param === 'Columns') {
        defaults[param] = true;
      }
    });
    
    return defaults;
  }

  /**
   * Obtiene los valores por defecto para KSB1
   */
  getKSB1Defaults(parameters: string[]): any {
    const defaults: any = {};
    
    parameters.forEach(param => {
      if (param.includes('ControllingArea')) {
        defaults[param] = '2000';
      } else if (param.includes('CostCenterGroup')) {
        defaults[param] = '0001';
      } else if (param.includes('CostElementGroup')) {
        defaults[param] = 'CE_STD';
      } else if (param.includes('Layout')) {
        defaults[param] = '/ALLDETAIL';
      } else if (param === 'NoSum') {
        defaults[param] = ['All'];
      } else if (param === 'Columns') {
        defaults[param] = ['All'];
      }
    });
    
    return defaults;
  }

  /**
   * Obtiene los valores por defecto para KOB1
   */
  getKOB1Defaults(parameters: string[]): any {
    const defaults: any = {};
    
    parameters.forEach(param => {
      if (param.includes('ControllingArea')) {
        defaults[param] = '2000';
      } else if (param.includes('OrderLOW')) {
        defaults[param] = '50000000';
      } else if (param.includes('OrderHIGH')) {
        defaults[param] = '59999999';
      } else if (param.includes('CostElementGroup')) {
        defaults[param] = 'CE_STD';
      } else if (param.includes('Layout')) {
        defaults[param] = '/ALL_COST';
      } else if (param === 'NoSum') {
        defaults[param] = ['All'];
      } else if (param === 'Columns') {
        defaults[param] = ['All'];
      }
    });
    
    return defaults;
  }

  /**
   * Obtiene los valores por defecto para CJI3
   */
  getCJI3Defaults(parameters: string[], customName: string): any {
    const defaults: any = {};
    
    // Agregar FurtherSettings si no está presente para CJI3_CANDALL
    const parametersSet = new Set<string>(parameters);
    if (customName === 'CJI3_CANDALL' && !parametersSet.has('FurtherSettings')) {
      parameters.push('FurtherSettings');
    }
    
    parameters.forEach(param => {
      if (param.includes('ControllingArea') || param.includes('Controlling Area')) {
        defaults[param] = '2000';
      } else if (param.includes('Database prof.') || param.includes('Database prof')) {
        defaults[param] = '000000000001';
      } else if (param.includes('ProjectLOW') || param.includes('Project LOW')) {
        defaults[param] = customName.includes('ALLCOST') ? '2000*' : '2000-CAP*';
      } else if (param.includes('ProjectHIGH') || param.includes('Project HIGH')) {
        defaults[param] = customName.includes('ALLCOST') ? '2100*' : '2100-CAP*';
      } else if (param.includes('Network/OrderLOW') || param.includes('Network/Order LOW')) {
        defaults[param] = '2100*';
      } else if (param.includes('CostElementGroup') || param.includes('Cost Element Group')) {
        defaults[param] = 'CE_STD';
      } else if (param.includes('Layout')) {
        defaults[param] = customName.includes('ALLCOST') ? '/ALLCOST' : '/1CANDALL';
      } else if (param.includes('FurtherSettings') || param.includes('Further Settings')) {
        defaults[param] = '99999999';
      } else if (param === 'NoSum') {
        defaults[param] = ['All'];
      } else if (param === 'Columns') {
        defaults[param] = ['All'];
      }
    });
    
    return defaults;
  }

  /**
   * Selecciona una plantilla
   */
  selectTemplate(templateId: string): void {
    this.currentTemplateId = templateId;
    const template = this.getCurrentTemplate();
    if (template && template.forms.length > 0) {
      this.selectForm(template.forms[0].id);
    } else {
      this.currentFormId = null;
    }
  }

  /**
   * Selecciona un formulario
   */
  selectForm(formId: string): void {
    this.currentFormId = formId;
    this.restoreFormData(formId);
  }

  /**
   * Obtiene la plantilla actual
   */
  getCurrentTemplate(): SyncTemplate | null {
    return this.templates.find(t => t.id === this.currentTemplateId) || null;
  }

  /**
   * Obtiene el formulario actual
   */
  getCurrentForm(): TemplateForm | null {
    if (!this.currentFormId) return null;
    const template = this.getCurrentTemplate();
    if (!template) return null;
    return template.forms.find(f => f.id === this.currentFormId) || null;
  }

  /**
   * Restaura los datos del formulario desde el cache
   */
  restoreFormData(formId: string): void {
    if (this.formDataCache[formId]) {
      // Los datos ya están en el cache
    }
  }

  /**
   * Guarda los datos del formulario en el cache
   */
  saveFormData(formId: string): void {
    const form = this.getCurrentForm();
    if (!form) return;
    
    // Inicializar con valores existentes o valores por defecto
    const formData: any = { ...(this.formDataCache[formId] || form.defaultValues) };
    
    // Actualizar con los valores actuales del formulario
    form.parameters.forEach(param => {
      // Normalizar el nombre del parámetro para el ID (igual que en sync-packages)
      const paramId = this.normalizeParamForId(param);
      const elementId = `param_${formId}_${paramId}`;
      
      // Usar getElementById en lugar de querySelector para evitar problemas con caracteres especiales
      const input = document.getElementById(elementId) as HTMLInputElement;
      if (input) {
        if (input.type === 'checkbox') {
          formData[param] = input.checked ? ['All'] : [];
        } else {
          // Guardar el valor, incluso si está vacío
          formData[param] = input.value;
        }
      } else {
        // Si el input no existe, asegurar que el parámetro esté presente con valor vacío o por defecto
        if (!(param in formData)) {
          formData[param] = '';
        }
      }
    });
    
    this.formDataCache[formId] = formData;
    form.defaultValues = { ...formData };
  }

  /**
   * Guarda la plantilla en SFTP
   */
  saveTemplate(templateId: string): void {
    const template = this.templates.find(t => t.id === templateId);
    if (!template) return;

    // Guardar versión anterior en historial antes de modificar
    this.saveTemplateVersion(templateId);

    // Guardar datos de TODOS los formularios antes de guardar
    template.forms.forEach(form => {
      // Guardar datos del formulario si está visible
      if (this.currentFormId === form.id) {
        this.saveFormData(form.id);
      } else {
        // Si el formulario no está visible, guardar desde el cache o valores por defecto
        // pero asegurando que todos los parámetros estén presentes
        const formData: any = { ...(this.formDataCache[form.id] || form.defaultValues) };
        
        // Asegurar que todos los parámetros estén presentes
        form.parameters.forEach(param => {
          if (!(param in formData)) {
            formData[param] = '';
          }
        });
        
        this.formDataCache[form.id] = formData;
        form.defaultValues = { ...formData };
      }
    });

    // Construir el objeto de datos de la plantilla
    const templateData: any = {};
    template.forms.forEach(form => {
      const formData = this.formDataCache[form.id] || form.defaultValues;
      
      // Asegurar que todos los parámetros estén incluidos, incluso si están vacíos
      const completeFormData: any = {
        tcode: form.tcode
      };
      
      form.parameters.forEach(param => {
        // Incluir el parámetro incluso si está vacío o undefined
        completeFormData[param] = formData[param] !== undefined ? formData[param] : '';
      });
      
      templateData[form.customName] = completeFormData;
    });

    // ===== VALIDACIÓN ANTES DE GUARDAR =====
    const availableFlowNames = this.availableFlows.map(f => f.name);
    this.validationResult = this.templateValidator.validateTemplate(template, availableFlowNames);
    
    // Si hay errores críticos, mostrar y no guardar
    if (this.validationResult.errors.length > 0) {
      const errorMessages = this.validationResult.errors.map(e => e.message).join('\n');
      alert(`Error: La plantilla tiene ${this.validationResult.errors.length} error(es) que deben corregirse antes de guardar:\n${errorMessages}`);
      this.showValidationPanel = true; // Mostrar panel para ver errores
      return;
    }
    
    // Si hay warnings, mostrar pero permitir guardar
    if (this.validationResult.warnings.length > 0) {
      const warningMessages = this.validationResult.warnings.slice(0, 3).map(w => w.message).join('\n');
      const moreWarnings = this.validationResult.warnings.length > 3 ? `\n... y ${this.validationResult.warnings.length - 3} advertencia(s) más` : '';
      if (!confirm(`Advertencia: La plantilla tiene ${this.validationResult.warnings.length} advertencia(s):\n${warningMessages}${moreWarnings}\n\n¿Desea continuar guardando?`)) {
        return;
      }
    }
    // ===== FIN VALIDACIÓN =====

    const fileName = `${template.name}.json`;
    
    // IMPORTANTE: Guardar en el directorio de PLANTILLAS (sap-query-package), NO en sap-queries
    console.log(`Guardando plantilla "${template.name}" en directorio: ${this.TEMPLATES_DIRECTORY}`);
    
    this.sftpService.savePackageToSftp(
      fileName,
      templateData,
      true, // overwrite
      this.TEMPLATES_DIRECTORY // 'sap-query-package' - directorio de PLANTILLAS
    ).subscribe({
      next: (response) => {
        if (response.status) {
          alert(`Plantilla ${template.name} guardada exitosamente`);
        } else {
          alert(`Error al guardar: ${response.message}`);
        }
      },
      error: (error) => {
        console.error('Error al guardar plantilla:', error);
        alert('Error al guardar la plantilla');
      }
    });
  }

  /**
   * Elimina una plantilla
   */
  deleteTemplate(templateId: string): void {
    if (confirm('¿Está seguro de eliminar esta plantilla?')) {
      this.templates = this.templates.filter(t => t.id !== templateId);
      if (this.currentTemplateId === templateId) {
        this.currentTemplateId = null;
        this.currentFormId = null;
      }
    }
  }

  /**
   * Renombra una plantilla
   */
  renameTemplate(templateId: string): void {
    const template = this.templates.find(t => t.id === templateId);
    if (!template) return;

    const newName = prompt('Ingrese el nuevo nombre para la plantilla:', template.name);
    if (newName && newName.trim()) {
      template.name = newName.trim();
    }
  }

  /**
   * Renombra un formulario/flujo dentro de una plantilla
   */
  renameForm(formId: string): void {
    const template = this.getCurrentTemplate();
    if (!template) return;

    const form = template.forms.find(f => f.id === formId);
    if (!form) return;

    const newName = prompt('Ingrese el nuevo nombre para el formulario:', form.customName);
    if (newName && newName.trim()) {
      form.customName = newName.trim();
    }
  }

  /**
   * Agrega un flujo adicional a una plantilla personalizada
   */
  addFlowToTemplate(): void {
    const template = this.getCurrentTemplate();
    if (!template || template.type !== 'CUSTOM') {
      return;
    }

    // Abrir el modal de selección de flujos
    this.selectedTemplateType = 'CUSTOM';
    this.showCreateTemplateModal = true;
    this.showFlowSelector = true;
    this.selectedFlowsForTemplate.clear();
    // Guardar el ID de la plantilla actual para agregar flujos a ella
    this.selectedPackageIdForFile = template.id;
  }

  /**
   * Normaliza el nombre de un parámetro para usarlo en IDs HTML
   */
  normalizeParamForId(param: string): string {
    return param.replace(/\s+/g, '_').replace(/[\/\[\]]/g, '_');
  }

  /**
   * Obtiene el valor de un parámetro del formulario actual
   */
  getParamValue(param: string): any {
    const form = this.getCurrentForm();
    if (!form) return '';
    
    const formData = this.formDataCache[form.id] || form.defaultValues;
    return formData[param] || '';
  }

  /**
   * Actualiza el valor de un parámetro
   */
  updateParamValue(param: string, value: any): void {
    const form = this.getCurrentForm();
    if (!form) return;
    
    if (!this.formDataCache[form.id]) {
      this.formDataCache[form.id] = { ...form.defaultValues };
    }
    
    this.formDataCache[form.id][param] = value;
  }

  /**
   * Elimina todas las plantillas existentes (solo elimina, no crea nada)
   */
  initializeTemplates(): void {
    if (!confirm('¿Está seguro? Esto eliminará todas las plantillas existentes.')) {
      return;
    }

    // Eliminar todas las plantillas existentes
    this.sftpService.listPackages(this.TEMPLATES_DIRECTORY).subscribe({
      next: (response) => {
        if (response.status && response.files) {
          const templateFiles = response.files.filter(f => 
            f.name.endsWith('.json') && !f.isDirectory
          );
          
          let deletedCount = 0;
          const totalFiles = templateFiles.length;
          
          if (totalFiles === 0) {
            // No hay archivos para eliminar
            alert('No hay plantillas para eliminar');
            // Recargar plantillas para actualizar la vista
            this.loadTemplatesFromSftp();
            return;
          }
          
          templateFiles.forEach(file => {
            this.sftpService.deleteFile(file.path, this.TEMPLATES_DIRECTORY).subscribe({
              next: (deleteResponse) => {
                deletedCount++;
                console.log(`Archivo eliminado: ${file.name}`, deleteResponse);
                
                if (deletedCount === totalFiles) {
                  console.log('Todas las plantillas eliminadas.');
                  alert(`Se eliminaron ${totalFiles} plantilla(s)`);
                  // Limpiar el estado actual
                  this.templates = [];
                  this.currentTemplateId = null;
                  // Recargar plantillas para actualizar la vista
                  this.loadTemplatesFromSftp();
                }
              },
              error: (error) => {
                console.error(`Error al eliminar ${file.name}:`, error);
                deletedCount++;
                if (deletedCount === totalFiles) {
                  alert('Se eliminaron las plantillas (algunas pueden haber fallado)');
                  // Recargar plantillas para actualizar la vista
                  this.loadTemplatesFromSftp();
                }
              }
            });
          });
        } else {
          alert('No se encontraron plantillas para eliminar');
          // Recargar plantillas para actualizar la vista
          this.loadTemplatesFromSftp();
        }
      },
      error: (error) => {
        console.error('Error al listar plantillas para eliminar:', error);
        alert('Error al listar plantillas');
      }
    });
  }

  /**
   * Crea las 2 plantillas por defecto: SUMMARY_SYNC y DETAILS_SYNC
   */
  private createDefaultTemplates(): void {
    console.log('Creando plantillas por defecto...');
    
    // Crear SUMMARY_SYNC
    this.createSummarySyncTemplateFromDefaults();
    
    // Crear DETAILS_SYNC
    setTimeout(() => {
      this.createDetailsSyncTemplateFromDefaults();
    }, 500);
  }

  /**
   * Crea la plantilla SUMMARY_SYNC con valores por defecto
   */
  private createSummarySyncTemplateFromDefaults(): void {
    // Buscar el archivo de manera más específica
    const zfirFile = this.availableFlows.find(f => {
      const fileName = f.name.toLowerCase();
      return fileName === 'zfir_statsload.json' || 
             fileName === 'zfir_statsload' ||
             (fileName.includes('zfir') && fileName.includes('statsload'));
    });

    if (!zfirFile) {
      console.error('No se encontró el flujo ZFIR_STATSLOAD');
      console.error('Flujos disponibles:', this.availableFlows.map(f => f.name));
      alert(`Error: No se encontró el flujo ZFIR_STATSLOAD.\n\nFlujos disponibles: ${this.availableFlows.map(f => f.name).join(', ')}`);
      return;
    }
    
    console.log('Archivo ZFIR_STATSLOAD encontrado para inicialización:', zfirFile);

    this.sftpService.getJsonFileContent(zfirFile.path).subscribe({
      next: (response) => {
        if (response.status && response.content) {
          try {
            const jsonData = JSON.parse(response.content);
            const parameters = this.extractParameters(jsonData);
            const defaultValues = this.getSummarySyncDefaults(parameters);
            
            // Construir el objeto de la plantilla
            const templateData: any = {
              ZFIR_STATSLOAD: {
                tcode: 'ZFIR_STATSLOAD',
                ...defaultValues
              }
            };
            
            // Guardar la plantilla
            this.sftpService.savePackageToSftp(
              'SUMMARY_SYNC.json',
              templateData,
              true, // overwrite
              this.TEMPLATES_DIRECTORY
            ).subscribe({
              next: (saveResponse) => {
                if (saveResponse.status) {
                  console.log('Plantilla SUMMARY_SYNC creada exitosamente');
                  // Recargar plantillas
                  setTimeout(() => {
                    this.loadTemplatesFromSftp();
                  }, 500);
                } else {
                  console.error('Error al guardar SUMMARY_SYNC:', saveResponse.message);
                  alert(`Error al guardar SUMMARY_SYNC: ${saveResponse.message}`);
                }
              },
              error: (error) => {
                console.error('Error al guardar SUMMARY_SYNC:', error);
                alert('Error al guardar la plantilla SUMMARY_SYNC');
              }
            });
          } catch (error) {
            console.error('Error al procesar SUMMARY_SYNC:', error);
            alert('Error al procesar el flujo ZFIR_STATSLOAD');
          }
        }
      },
      error: (error) => {
        console.error('Error al cargar flujo ZFIR_STATSLOAD:', error);
        alert('Error al cargar el flujo base ZFIR_STATSLOAD');
      }
    });
  }

  /**
   * Crea la plantilla DETAILS_SYNC con valores por defecto
   */
  private createDetailsSyncTemplateFromDefaults(): void {
    const tcodes = [
      { tcode: 'KSB1', customName: 'KSB1' },
      { tcode: 'KOB1', customName: 'KOB1' },
      { tcode: 'CJI3', customName: 'CJI3_ALLCOST' },
      { tcode: 'CJI3', customName: 'CJI3_CANDALL' }
    ];

    const templateData: any = {};
    let filesLoaded = 0;
    const totalFiles = tcodes.length;

    tcodes.forEach(tcodeInfo => {
      const flowFile = this.availableFlows.find(f => 
        f.name.toLowerCase() === `${tcodeInfo.tcode.toLowerCase()}.json`
      );

      if (flowFile) {
        this.sftpService.getJsonFileContent(flowFile.path).subscribe({
          next: (response) => {
            if (response.status && response.content) {
              try {
                const jsonData = JSON.parse(response.content);
                const parameters = this.extractParameters(jsonData);
                
                let defaultValues: any;
                if (tcodeInfo.tcode === 'KSB1') {
                  defaultValues = this.getKSB1Defaults(parameters);
                } else if (tcodeInfo.tcode === 'KOB1') {
                  defaultValues = this.getKOB1Defaults(parameters);
                } else {
                  defaultValues = this.getCJI3Defaults(parameters, tcodeInfo.customName);
                }
                
                templateData[tcodeInfo.customName] = {
                  tcode: tcodeInfo.tcode,
                  ...defaultValues
                };
                
                filesLoaded++;
                
                if (filesLoaded === totalFiles) {
                  // Guardar la plantilla DETAILS_SYNC
                  this.sftpService.savePackageToSftp(
                    'DETAILS_SYNC.json',
                    templateData,
                    true, // overwrite
                    this.TEMPLATES_DIRECTORY
                  ).subscribe({
                    next: (saveResponse) => {
                      if (saveResponse.status) {
                        console.log('Plantilla DETAILS_SYNC creada exitosamente');
                        alert('Plantillas inicializadas correctamente: SUMMARY_SYNC y DETAILS_SYNC');
                        // Recargar plantillas
                        setTimeout(() => {
                          this.loadTemplatesFromSftp();
                        }, 500);
                      } else {
                        console.error('Error al guardar DETAILS_SYNC:', saveResponse.message);
                        alert(`Error al guardar DETAILS_SYNC: ${saveResponse.message}`);
                      }
                    },
                    error: (error) => {
                      console.error('Error al guardar DETAILS_SYNC:', error);
                      alert('Error al guardar la plantilla DETAILS_SYNC');
                    }
                  });
                }
              } catch (error) {
                console.error(`Error al procesar ${tcodeInfo.tcode}:`, error);
                filesLoaded++;
              }
            }
          },
          error: (error) => {
            console.error(`Error al cargar ${tcodeInfo.tcode}:`, error);
            filesLoaded++;
          }
        });
      } else {
        console.warn(`No se encontró el flujo ${tcodeInfo.tcode}`);
        filesLoaded++;
      }
    });
  }
  
  /**
   * Guarda una versión de la plantilla en el historial
   */
  private saveTemplateVersion(templateId: string): void {
    const template = this.templates.find(t => t.id === templateId);
    if (!template) return;
    
    // Crear una copia profunda de la plantilla
    const templateCopy: SyncTemplate = JSON.parse(JSON.stringify(template));
    
    // Agregar al historial
    if (!this.templateHistory.has(templateId)) {
      this.templateHistory.set(templateId, []);
    }
    
    const history = this.templateHistory.get(templateId)!;
    history.push(templateCopy);
    
    // Mantener solo las últimas 10 versiones
    if (history.length > 10) {
      history.shift();
    }
  }
  
  /**
   * Obtiene el historial de una plantilla
   */
  getTemplateHistory(templateId: string): SyncTemplate[] {
    return this.templateHistory.get(templateId) || [];
  }
  
  /**
   * Compara la versión actual con una versión anterior
   */
  compareTemplateVersions(templateId: string, versionIndex: number): void {
    const template = this.templates.find(t => t.id === templateId);
    if (!template) return;
    
    const history = this.getTemplateHistory(templateId);
    if (versionIndex < 0 || versionIndex >= history.length) return;
    
    const oldVersion = history[versionIndex];
    this.comparisonResult = this.templateValidator.compareTemplates(oldVersion, template);
    this.showComparisonPanel = true;
  }
  
  /**
   * Simula la aplicación de fechas a la plantilla actual
   */
  previewTemplateWithDates(dateRange: { startDate: string; endDate?: string; periodType: 'month' | 'day' }): void {
    const template = this.getCurrentTemplate();
    if (!template) {
      alert('No hay plantilla seleccionada');
      return;
    }
    
    this.previewDateRange = dateRange;
    this.previewData = this.templateValidator.simulateDateApplication(template, dateRange);
    this.showPreviewPanel = true;
  }
  
  /**
   * Toggle del panel de validación
   */
  toggleValidationPanel(): void {
    this.showValidationPanel = !this.showValidationPanel;
    
    if (this.showValidationPanel && this.currentTemplateId) {
      const template = this.getCurrentTemplate();
      if (template) {
        const availableFlowNames = this.availableFlows.map(f => f.name);
        this.validationResult = this.templateValidator.validateTemplate(template, availableFlowNames);
      }
    }
  }
  
  /**
   * Toggle del panel de vista previa
   */
  togglePreviewPanel(): void {
    this.showPreviewPanel = !this.showPreviewPanel;
  }
  
  /**
   * Toggle del panel de comparación
   */
  toggleComparisonPanel(): void {
    this.showComparisonPanel = !this.showComparisonPanel;
  }
  
  /**
   * Convierte los datos de vista previa a string JSON
   */
  getPreviewJsonString(): string {
    if (!this.previewData) return '';
    try {
      return JSON.stringify(this.previewData, null, 2);
    } catch (e) {
      return String(this.previewData);
    }
  }

  /**
   * Previsualiza la plantilla con la fecha de hoy
   */
  previewTemplateWithTodayDate(): void {
    const today = new Date().toISOString().split('T')[0];
    this.previewTemplateWithDates({ startDate: today, periodType: 'day' });
  }

  /**
   * Obtiene la fecha actual como string formateada
   */
  getCurrentDateString(): string {
    return new Date().toLocaleString('es-ES');
  }
}

