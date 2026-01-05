import { Component, OnInit, OnChanges, SimpleChanges, Input, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FlowService } from '../../services/flow.service';
import { FileService, FileInfo } from '../../services/file.service';
import { SftpService } from '../../services/sftp.service';
import { FlowValidatorService, ValidationResult } from '../../services/flow-validator.service';
import { FlowNode, Connection, SapFlow } from '../../models/flow.model';
import { TargetSelectorComponent } from '../target-selector/target-selector.component';
import { Subscription } from 'rxjs';
import { SapTarget } from '../../services/targets.service';

// Interfaz para contenedores de targets
interface TargetContainer {
  id: string;
  targetContextKey: string; // Clave base del contexto (ej: "SCAREA")
  instanceNumber: number; // Número de instancia (1, 2, 3, ...)
  fullKey: string; // Clave completa con instancia (ej: "SCAREA::1")
  friendlyName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  controls: FlowNode[];
  isCollapsed?: boolean;
  colorClass?: string; // Clase CSS para el color del contenedor
  nextContainerId?: string; // ID del siguiente contenedor en el flujo
}

@Component({
  selector: 'app-flow-editor',
  templateUrl: './flow-editor.component.html',
  styleUrls: ['./flow-editor.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, TargetSelectorComponent]
})
export class FlowEditorComponent implements OnInit, OnChanges {
  @Input() jsonContent: string = '';
  
  editorOptions = {
    theme: 'vs-dark',
    language: 'json',
    automaticLayout: true,
    minimap: { enabled: false },
    formatOnPaste: true,
    formatOnType: true
  };
  
  flowCode: string = '';
  isEditing: boolean = false;
  originalFlowCode: string = ''; // Guardar el contenido original antes de editar
  
  // Variables para el editor de JSON de nodo
  showNodeEditor: boolean = false;
  nodeJsonContent: string = '';
  nodeJsonError: string | null = null;
  editingNodeId: string | null = null;
  
  // Variables para zoom y desplazamiento
  zoomLevel: number = 1;
  panOffsetX: number = 0;
  panOffsetY: number = 0;
  isPanning: boolean = false;
  lastMouseX: number = 0;
  lastMouseY: number = 0;
  
  // Variables para organización automática
  gridSize: number = 20;
  autoArrangeMode: boolean = false;
  
  // Variables para control de espaciado
  horizontalSpacing: number = 120;
  verticalSpacing: number = 100;
  
  // Control de layout automático (deshabilitado para evitar problemas de rendimiento)
  autoLayoutEnabled: boolean = false;
  
  // Variables para el estado de guardado
  isSaving: boolean = false;
  saveMessage: string = '';
  saveMessageType: 'success' | 'error' | 'info' = 'info';
  
  // Bandera para prevenir reimportación durante el guardado
  private isUpdatingFile: boolean = false;
  private lastImportedContent: string = '';
  nodeSpacingOptions = [
    { label: 'Compacto', horizontal: 80, vertical: 60 },
    { label: 'Normal', horizontal: 120, vertical: 100 },
    { label: 'Amplio', horizontal: 160, vertical: 130 },
    { label: 'Extra Amplio', horizontal: 200, vertical: 160 }
  ];
  
  // Variables específicas para containers
  containerSpacingMultiplier: number = 1.8;
  containerSpacingOptions = [
    { label: 'Compacto', multiplier: 1.3 },
    { label: 'Normal', multiplier: 1.8 },
    { label: 'Amplio', multiplier: 2.2 },
    { label: 'Extra Amplio', multiplier: 2.8 }
  ];
  
  // Variables para modo pantalla completa
  isFullscreen: boolean = false;
  originalHeight: string = '500px';
  fullscreenHeight: string = '100vh';
  canvasHeight: string = '600px'; // Altura inicial del canvas
  
  // Variables para paneles flotantes (estilo Figma)
  showLeftPanel: boolean = true; // Panel izquierdo (Controles SAP) - abierto por defecto
  showRightPanel: boolean = false; // Panel derecho (propiedades/configuración)
  leftPanelWidth: number = 320; // Ancho del panel izquierdo
  rightPanelWidth: number = 320; // Ancho del panel derecho
  showGrid: boolean = false; // Variable para controlar la visibilidad de la cuadrícula
  
  // Variables para modo oscuro/claro y configuración de visualización
  isDarkMode: boolean = true;
  showMinimap: boolean = false;
  showNodeLabels: boolean = true;
  
  flowElements = [
    { type: 'action', label: 'Acción', icon: 'bi-play-circle' },
    { type: 'decision', label: 'Decisión', icon: 'bi-diamond' }
  ];
  
  flowNodes: FlowNode[] = [];
  targetContextNodes: FlowNode[] = [];
  targetContainers: TargetContainer[] = [];
  connections: Connection[] = [];
  containerConnections: Array<{ sourceId: string; targetId: string }> = []; // Conexiones entre contenedores
  selectedNode: FlowNode | null = null;
  selectedTargetContextNode: FlowNode | null = null;
  selectedContainer: TargetContainer | null = null;
  isDragging = false;
  isDraggingContainer = false;
  dragContainerOffset = { x: 0, y: 0 };
  draggedContainer: TargetContainer | null = null;
  dragOverContainer: TargetContainer | null = null;
  
  // Variables para drag and drop dentro de contenedores
  draggedControl: FlowNode | null = null;
  draggedControlContainer: TargetContainer | null = null;
  dragOverControl: FlowNode | null = null;
  dragOverControlIndex: number = -1;
  
  // Variables para pestañas
  activeTab: 'steps' | 'targetContext' = 'targetContext'; // TEMPORALMENTE: Cambiado a 'targetContext' porque la pestaña Steps está comentada
  flowData: any = null;
  stepsData: any = null;
  targetContextData: any = null;
  targetContextAccordionState: { [key: number]: boolean } = {};
  currentFlowFileName: string = ''; // Nombre del flujo actual cargado

  // Métodos para TargetContext
  getTargetContextKeys(): string[] {
    if (!this.targetContextData) return [];
    return Object.keys(this.targetContextData);
  }

  getTargetContextCount(): number {
    if (!this.targetContextData) return 0;
    return Object.keys(this.targetContextData).length;
  }

  getTargetContextFriendlyName(contextKey: string): string | null {
    if (!this.targetContextData || !this.targetContextData[contextKey]) return null;
    const context = this.targetContextData[contextKey];
    if (typeof context === 'object' && context.FriendlyName) {
      return context.FriendlyName;
    }
    return null;
  }

  isTargetContextString(contextKey: string): boolean {
    if (!this.targetContextData || !this.targetContextData[contextKey]) return false;
    return typeof this.targetContextData[contextKey] === 'string';
  }

  getTargetContextValue(contextKey: string): string {
    if (!this.targetContextData || !this.targetContextData[contextKey]) return '';
    return this.targetContextData[contextKey];
  }

  getTargetContextDeepAliases(contextKey: string): any {
    if (!this.targetContextData || !this.targetContextData[contextKey]) return null;
    const context = this.targetContextData[contextKey];
    if (typeof context === 'object' && context.deepaliases) {
      return context.deepaliases;
    }
    return null;
  }

  getTargetContextDeepAliasesKeys(contextKey: string): string[] {
    const aliases = this.getTargetContextDeepAliases(contextKey);
    if (!aliases) return [];
    return Object.keys(aliases);
  }

  getTargetContextDeepAliasValue(contextKey: string, alias: string): string {
    const aliases = this.getTargetContextDeepAliases(contextKey);
    if (!aliases || !aliases[alias]) return '';
    return aliases[alias];
  }

  getTargetContextTargetMap(contextKey: string): any {
    if (!this.targetContextData || !this.targetContextData[contextKey]) return null;
    const context = this.targetContextData[contextKey];
    if (typeof context === 'object' && context.targetMap) {
      return context.targetMap;
    }
    return null;
  }

  getTargetContextTargetMapKeys(contextKey: string): string[] {
    const targetMap = this.getTargetContextTargetMap(contextKey);
    if (!targetMap) return [];
    return Object.keys(targetMap);
  }

  getTargetContextTargetMapValue(contextKey: string, mapKey: string): string {
    const targetMap = this.getTargetContextTargetMap(contextKey);
    if (!targetMap || !targetMap[mapKey]) return '';
    return targetMap[mapKey];
  }

  /**
   * Toggle del acordeón de TargetContext
   */
  toggleTargetContextAccordion(index: number): void {
    this.targetContextAccordionState[index] = !this.targetContextAccordionState[index];
  }

  /**
   * Verifica si un item del acordeón está abierto
   */
  isTargetContextAccordionOpen(index: number): boolean {
    // Por defecto, el primer item está abierto
    if (index === 0 && this.targetContextAccordionState[index] === undefined) {
      return true;
    }
    return this.targetContextAccordionState[index] === true;
  }

  /**
   * Obtiene los targetContext disponibles desde SFTP
   */
  getAvailableTargetContexts(): Array<{ key: string; friendlyName: string; path?: string; flowContextKey?: string }> {
    return this.availableTargets;
  }

  /**
   * Obtiene el tooltip para un target context
   */
  getTargetContextTooltip(context: { key: string; friendlyName: string; path?: string; flowContextKey?: string }): string {
    // Mostrar el flowContextKey si está disponible (es el ID real del target context en el flujo)
    // Si no, mostrar el key
    const id = context.flowContextKey || context.key;
    return `ID: ${id}`;
  }

  /**
   * Carga los targets disponibles desde SFTP (todos los targets)
   * NOTA: Este método carga los targets inicialmente. Cuando se carga un flujo específico,
   * loadTargetsForCurrentFlow sobrescribirá estos targets con los FriendlyName correctos.
   */
  loadTargetsFromSftp(): void {
    this.loadingTargets = true;
    this.availableTargets = [];

    this.sftpService.listTargets().subscribe({
      next: (response) => {
        this.loadingTargets = false;
        if (response.status && response.files) {
          // Procesar archivos JSON de targets
          // Inicialmente usar el nombre del archivo como clave
          // Cuando se cargue un flujo específico, estos se sobrescribirán con FriendlyName
          this.availableTargets = response.files
            .filter(file => !file.isDirectory && file.name.endsWith('.json'))
            .map(file => {
              // Extraer el nombre base del target (sin -targets.json)
              // Ejemplo: "CJI3-targets.json" -> "CJI3"
              const key = file.name.replace('-targets.json', '').replace('.json', '');
              return {
                key: key,
                friendlyName: key, // Se actualizará cuando se cargue el contenido o se cargue un flujo
                path: file.path
              };
            });
          
          // Cargar contenido de cada target para obtener FriendlyName (solo si no hay flujo cargado)
          // Si hay un flujo cargado, los targets se cargarán desde loadTargetsForCurrentFlow
          if (!this.currentFlowFileName) {
            this.loadTargetsMetadata();
          }
        } else {
          console.error('Error al cargar targets:', response.message);
        }
      },
      error: (error) => {
        this.loadingTargets = false;
        console.error('Error al cargar targets desde SFTP:', error);
      }
    });
  }

  /**
   * Carga los targets correspondientes al flujo actual
   * Ejemplo: flujo "cji3.json" -> targets "CJI3-targets.json"
   */
  loadTargetsForCurrentFlow(flowFileName: string): void {
    if (!flowFileName) {
      console.log('loadTargetsForCurrentFlow: No hay nombre de archivo');
      return;
    }

    console.log('loadTargetsForCurrentFlow llamado con:', flowFileName);
    console.log('currentFlowFileName actual:', this.currentFlowFileName);

    // Extraer nombre base del flujo (sin extensión y sin ruta)
    let flowNameBase = flowFileName;
    // Remover extensión .json si existe
    if (flowNameBase.endsWith('.json')) {
      flowNameBase = flowNameBase.replace('.json', '');
    }
    // Remover ruta si existe (solo tomar el nombre del archivo)
    if (flowNameBase.includes('/')) {
      flowNameBase = flowNameBase.split('/').pop() || flowNameBase;
    }
    // Convertir a mayúsculas
    flowNameBase = flowNameBase.toUpperCase();
    console.log('flowNameBase procesado:', flowNameBase);
    
    // Construir nombre del archivo de targets
    const targetFileName = `${flowNameBase}-targets.json`;
    console.log('Buscando archivo de targets:', targetFileName);
    
    // Buscar el archivo de targets en la lista
    this.loadingTargets = true;
    this.sftpService.listTargets().subscribe({
      next: (response) => {
        this.loadingTargets = false;
        if (response.status && response.files) {
          console.log('Archivos de targets encontrados:', response.files.map(f => f.name));
          const targetFile = response.files.find(
            f => !f.isDirectory && f.name === targetFileName
          );
          
          if (targetFile) {
            console.log('Archivo de targets encontrado:', targetFile.path);
            // Cargar el contenido del archivo de targets
            this.sftpService.getTargetContent(targetFile.path).subscribe({
              next: (targetResponse) => {
                if (targetResponse.status && targetResponse.content) {
                  try {
                    const targetsData = JSON.parse(targetResponse.content);
                    console.log('loadTargetsForCurrentFlow - targetsData cargado con', Object.keys(targetsData.TargetControls || {}).length, 'targets');
                    // Guardar el JSON completo para previsualización
                    this.targetsJsonData = targetsData;
                    // Procesar los targets del archivo
                    // IMPORTANTE: Esto sobrescribirá availableTargets con los FriendlyName correctos
                    // Pasar el path real del archivo para que se use correctamente
                    this.processTargetsFromFile(targetsData, flowNameBase, targetFile.path);
                  } catch (error) {
                    console.error('Error al parsear targets:', error);
                  }
                } else {
                  console.error('Error en respuesta de getTargetContent:', targetResponse.message);
                }
              },
              error: (error) => {
                console.error('Error al cargar contenido de targets:', error);
                this.loadingTargets = false;
              }
            });
          } else {
            console.warn(`No se encontró archivo de targets para el flujo: ${targetFileName}`);
            console.log('Archivos disponibles:', response.files.map(f => f.name));
            // Si no se encuentra el archivo específico, intentar cargar todos los targets disponibles
            console.log('Intentando cargar todos los targets disponibles como fallback...');
            this.loadAllAvailableTargets();
          }
        } else {
          console.error('Error en respuesta de listTargets:', response.message);
          this.loadingTargets = false;
        }
      },
      error: (error) => {
        this.loadingTargets = false;
        console.error('Error al buscar targets del flujo:', error);
      }
    });
  }

  /**
   * Procesa los targets cargados desde un archivo
   * El archivo contiene TargetControls donde cada clave es un FriendlyName (ej: "Set Controlling Area")
   */
  processTargetsFromFile(targetsData: any, flowNameBase: string, targetFilePath?: string): void {
    // El archivo contiene un objeto con la estructura: { Tcode, Generated, TargetControls: { ... } }
    if (typeof targetsData === 'object' && !Array.isArray(targetsData)) {
      // Usar el path proporcionado o construir uno por defecto
      const filePath = targetFilePath || `~/lek-files-dev/can/sap-config/sap-gui-flow/sap-targets$/${flowNameBase}-targets.json`;
      
      // Procesar TargetControls si existe
      if (targetsData.TargetControls && typeof targetsData.TargetControls === 'object') {
        const targetKeys = Object.keys(targetsData.TargetControls);
        
        // Limpiar targets anteriores para este flujo
        // IMPORTANTE: Esto sobrescribe cualquier target cargado previamente por loadTargetsFromSftp
        this.availableTargets = [];
        this.targetContextKeyToFriendlyNameMap = {};
        
        // Crear mapeo entre claves del targetContext del flujo y FriendlyName del archivo
        if (this.targetContextData) {
          Object.keys(this.targetContextData).forEach(flowKey => {
            const context = this.targetContextData[flowKey];
            if (typeof context === 'object' && context.FriendlyName) {
              const friendlyName = context.FriendlyName;
              // Buscar si este FriendlyName existe en TargetControls
              if (targetsData.TargetControls[friendlyName]) {
                this.targetContextKeyToFriendlyNameMap[flowKey] = friendlyName;
              }
            }
          });
        }
        
        targetKeys.forEach(friendlyName => {
          const targetControls = targetsData.TargetControls[friendlyName];
          
          // Buscar la clave del targetContext del flujo que corresponde a este FriendlyName
          const flowKey = Object.keys(this.targetContextKeyToFriendlyNameMap).find(
            key => this.targetContextKeyToFriendlyNameMap[key] === friendlyName
          ) || friendlyName; // Si no hay mapeo, usar el FriendlyName como clave
          
          // Agregar a la lista de targets disponibles
          // IMPORTANTE: Usar FriendlyName como key, no el nombre del archivo
          this.availableTargets.push({
            key: friendlyName, // Usar FriendlyName como clave principal
            friendlyName: friendlyName,
            path: filePath,
            flowContextKey: flowKey // Guardar la clave del flujo para referencia
          });
        });
        
        // Si hay targets disponibles y no hay uno seleccionado, seleccionar el primero
        if (targetKeys.length > 0 && !this.selectedTargetContext) {
          const firstTargetKey = targetKeys[0];
          // Cargar los controles del primer target automáticamente
          setTimeout(() => {
            this.selectTargetContextForControls(firstTargetKey);
          }, 100);
        }
      }
    }
  }

  /**
   * Carga los metadatos (FriendlyName) de cada target
   */
  loadTargetsMetadata(): void {
    this.availableTargets.forEach((target, index) => {
      this.sftpService.getTargetContent(target.path).subscribe({
        next: (response) => {
          if (response.status && response.content) {
            try {
              const targetData = JSON.parse(response.content);
              // Actualizar FriendlyName si existe
              if (targetData.FriendlyName) {
                this.availableTargets[index].friendlyName = targetData.FriendlyName;
              }
            } catch (error) {
              console.error('Error al parsear target:', error);
            }
          }
        },
        error: (error) => {
          console.error('Error al cargar metadata del target:', error);
        }
      });
    });
  }

  /**
   * Carga todos los targets disponibles desde SFTP
   * Útil para flujos en blanco donde no hay un archivo de targets específico
   */
  loadAllAvailableTargets(): void {
    this.loadingTargets = true;
    // Limpiar targets anteriores antes de cargar nuevos
    this.availableTargets = [];

    this.sftpService.listTargets().subscribe({
      next: (response) => {
        if (response.status && response.files) {
          const targetFiles = response.files.filter(file => !file.isDirectory && file.name.endsWith('.json'));

          if (targetFiles.length === 0) {
            console.warn('loadAllAvailableTargets - No se encontraron archivos de targets');
            this.loadingTargets = false;
            return;
          }

          // Cargar contenido de cada archivo de targets
          let loadedCount = 0;
          const totalFiles = targetFiles.length;
          
          targetFiles.forEach(targetFile => {
            this.sftpService.getTargetContent(targetFile.path).subscribe({
              next: (targetResponse) => {
                if (targetResponse.status && targetResponse.content) {
                  try {
                    const targetsData = JSON.parse(targetResponse.content);
                    
                    // Extraer todos los FriendlyName de TargetControls
                    if (targetsData.TargetControls && typeof targetsData.TargetControls === 'object') {
                      const friendlyNames = Object.keys(targetsData.TargetControls);
                      
                      friendlyNames.forEach(friendlyName => {
                        // Verificar si este FriendlyName ya existe en availableTargets
                        const exists = this.availableTargets.some(t => t.friendlyName === friendlyName);
                        if (!exists) {
                          this.availableTargets.push({
                            key: friendlyName,
                            friendlyName: friendlyName,
                            path: targetFile.path,
                            flowContextKey: friendlyName // Para flujos en blanco, usar FriendlyName como clave
                          });
                        }
                      });
                    }
                  } catch (error) {
                    console.error('Error al parsear target:', targetFile.name, error);
                  }
                } else {
                  console.warn('loadAllAvailableTargets - Respuesta sin contenido para:', targetFile.name);
                }
                
                loadedCount++;
                if (loadedCount === totalFiles) {
                  this.loadingTargets = false;
                }
              },
              error: (error) => {
                console.error('Error al cargar contenido de target:', targetFile.name, error);
                loadedCount++;
                if (loadedCount === totalFiles) {
                  this.loadingTargets = false;
                }
              }
            });
          });
        } else {
          this.loadingTargets = false;
          console.error('Error al cargar targets:', response.message);
        }
      },
      error: (error) => {
        this.loadingTargets = false;
        console.error('Error al listar targets desde SFTP:', error);
      }
    });
  }

  /**
   * Selecciona un targetContext y carga sus controles
   */
  selectTargetContextForControls(friendlyName: string): void {
    console.log('selectTargetContextForControls llamado con:', friendlyName);
    this.selectedTargetContext = friendlyName;
    this.controlSearchTerm = ''; // Limpiar búsqueda al cambiar de contexto
    this.selectedControlTypes = []; // Limpiar filtro de tipos al cambiar de contexto
    
    // Limpiar el contenedor seleccionado si no corresponde al nuevo target context
    if (this.selectedContainer) {
      const containerFriendlyName = this.selectedContainer.friendlyName;
      if (containerFriendlyName !== friendlyName) {
        console.log('Limpiando contenedor seleccionado porque no corresponde al nuevo target context');
        this.selectedContainer = null;
      }
    }
    
    // Encontrar el target seleccionado por FriendlyName
    const target = this.availableTargets.find(t => t.key === friendlyName || t.friendlyName === friendlyName);
    console.log('Target encontrado:', target);
    
    if (target) {
      this.selectedTargetPath = target.path;
      
      // Cargar el contenido del archivo de targets desde SFTP
      this.sftpService.getTargetContent(target.path).subscribe({
        next: (response) => {
          if (response.status && response.content) {
            try {
              const targetsData = JSON.parse(response.content);
              console.log('Datos parseados. Claves disponibles en TargetControls:', Object.keys(targetsData.TargetControls || {}));
              console.log('Buscando FriendlyName:', friendlyName);
              
              // El archivo tiene la estructura: { Tcode, Generated, TargetControls: { ... } }
              // Obtener el array de controles del targetContext específico usando FriendlyName
              const targetControls = targetsData.TargetControls?.[friendlyName];
              console.log('TargetControls encontrado:', targetControls ? `${targetControls.length} controles` : 'NO ENCONTRADO');
              
              if (targetControls && Array.isArray(targetControls)) {
                // Procesar los controles directamente desde el archivo
                this.processControlsFromTargetFile(targetControls);
              } else {
                console.error(`TargetContext '${friendlyName}' no encontrado en TargetControls`);
                console.log('Claves disponibles:', Object.keys(targetsData.TargetControls || {}));
                this.loadingControls = false;
              }
            } catch (error) {
              console.error('Error al parsear archivo de targets:', error);
              this.loadingControls = false;
            }
          } else {
            this.loadingControls = false;
            console.error('Error al cargar archivo de targets:', response.message);
          }
        },
        error: (error) => {
          this.loadingControls = false;
          console.error('Error al cargar archivo de targets desde SFTP:', error);
        }
      });
    } else {
      console.error('Target no encontrado:', friendlyName);
    }
  }

  /**
   * Carga un target desde SFTP y luego carga sus controles
   * @param targetPath Ruta del archivo de targets
   * @param friendlyName FriendlyName del targetContext (clave en TargetControls)
   */
  loadTargetFromSftp(targetPath: string, friendlyName: string): void {
    this.loadingControls = true;
    this.targetContextControls = [];

    this.sftpService.getTargetContent(targetPath).subscribe({
      next: (response) => {
        if (response.status && response.content) {
          try {
            const targetData = JSON.parse(response.content);
            // El archivo tiene la estructura: { Tcode, Generated, TargetControls: { ... } }
            // Obtener el array de controles del targetContext específico usando FriendlyName
            const targetControls = targetData.TargetControls?.[friendlyName];
            if (targetControls && Array.isArray(targetControls)) {
              // Procesar los controles directamente desde el archivo
              this.processControlsFromTargetFile(targetControls);
            } else {
              console.error(`TargetContext '${friendlyName}' no encontrado en TargetControls`);
              this.loadingControls = false;
            }
          } catch (error) {
            console.error('Error al parsear target:', error);
            this.loadingControls = false;
          }
        } else {
          this.loadingControls = false;
          console.error('Error al cargar target:', response.message);
        }
      },
      error: (error) => {
        this.loadingControls = false;
        console.error('Error al cargar target desde SFTP:', error);
      }
    });
  }

  /**
   * Procesa los controles desde el archivo de targets (muestra todos los controles)
   */
  processControlsFromTargetFile(targetControls: any[]): void {
    this.loadingControls = false;
    
    console.log('Procesando controles desde archivo:', targetControls?.length, 'controles totales');
    
    // Mapear todos los controles sin filtrar
    const allControls = targetControls
      .filter(control => control != null) // Filtrar null/undefined
      .map(control => {
        // Obtener valores con múltiples fallbacks
        const id = control.Id || control.id || '';
        const friendlyName = control.FriendlyName || control.friendlyName || '';
        const friendlyGroup = control.FriendlyGroup || control.friendlyGroup || '';
        // Capturar ControlType con todas las variantes posibles (mayúsculas y minúsculas)
        const controlType = control.ControlType || control.controlType || 'GuiControl';
        
        // Determinar el nombre amigable: usar FriendlyName si existe y no está vacío,
        // si no, usar FriendlyGroup, si no, usar el Id
        let displayName = friendlyName;
        if (!displayName || displayName.trim() === '' || displayName === id) {
          displayName = friendlyGroup || id;
        }
        
        // Si el displayName sigue siendo igual al id y el id es muy largo, usar una versión truncada
        if (displayName === id && id.length > 50) {
          const parts = id.split('/');
          displayName = parts[parts.length - 1] || id;
        }
        
        // El name debe ser el FriendlyName o un nombre descriptivo, NO el path/Id
        // El path se guarda por separado
        const controlName = friendlyName || friendlyGroup || (id.length > 50 ? id.split('/').pop() : id);
        
        return {
          name: controlName, // Usar el nombre descriptivo, no el path
          friendlyName: displayName || controlName || 'Sin nombre',
          controlType: controlType,
          path: id, // Guardar el path por separado (no se usa como target)
          isManipulable: control.isManipulable !== undefined ? control.isManipulable : true
        };
      });
    
    console.log('Controles encontrados:', allControls.length);
    console.log('Ejemplos de controles:', allControls.slice(0, 10));
    console.log('Tipos de controles únicos:', [...new Set(allControls.map(c => c.controlType))]);
    
    // Log específico para GuiTextField
    const textFields = allControls.filter(c => c.controlType === 'GuiTextField' || c.controlType === 'GuiCTextField');
    console.log('GuiTextField encontrados:', textFields.length);
    if (textFields.length > 0) {
      console.log('Ejemplos de GuiTextField:', textFields.slice(0, 5));
    }
    
    this.targetContextControls = allControls;
    
    // Actualizar tipos disponibles
    this.updateAvailableControlTypes();
    
    // Aplicar filtro inicial
    this.filterControls();
  }

  /**
   * Carga los controles de un targetContext desde el backend
   */
  loadTargetContextControls(targetContextKey: string, targetContextData?: any): void {
    this.loadingControls = true;
    this.targetContextControls = [];

    // Usar el targetContext proporcionado o intentar obtenerlo del flujo actual
    let targetContext = targetContextData;
    if (!targetContext) {
      targetContext = this.getTargetContextForControls(targetContextKey);
    }
    
    // Preparar el flujo completo si está disponible
    let flowData = null;
    if (this.flowData) {
      flowData = this.flowData;
    } else if (this.targetContextData && this.stepsData) {
      flowData = {
        $meta: this.flowData?.$meta || {},
        targetContext: this.targetContextData,
        steps: this.stepsData
      };
    }

    this.sftpService.getTargetContextControls(targetContextKey, targetContext, flowData).subscribe({
      next: (response) => {
        this.loadingControls = false;
        if (response.status && response.controls) {
          // Mostrar todos los controles, no solo los manipulables
          this.targetContextControls = response.controls;
          // Actualizar tipos disponibles
          this.updateAvailableControlTypes();
          this.filterControls(); // Aplicar filtro inicial
        } else {
          console.error('Error al cargar controles:', response.message);
          // Si hay error pero tenemos targetContext, usar fallback
          if (targetContext) {
            this.loadControlsFromDeepAliases(targetContextKey);
          }
        }
      },
      error: (error) => {
        this.loadingControls = false;
        console.error('Error al cargar controles desde el backend:', error);
        // Usar los deepaliases como fallback
        this.loadControlsFromDeepAliases(targetContextKey);
      }
    });
  }

  /**
   * Obtiene el targetContext completo para enviarlo al backend
   */
  private getTargetContextForControls(targetContextKey: string): any {
    if (!this.targetContextData || !this.targetContextData[targetContextKey]) {
      return null;
    }
    
    return this.targetContextData[targetContextKey];
  }

  /**
   * Carga controles desde deepaliases como fallback
   */
  loadControlsFromDeepAliases(targetContextKey: string): void {
    const deepAliases = this.getTargetContextDeepAliases(targetContextKey);
    if (deepAliases) {
      this.targetContextControls = Object.keys(deepAliases).map(alias => ({
        name: alias,
        friendlyName: alias,
        controlType: 'GuiControl', // Tipo genérico
        path: deepAliases[alias],
        isManipulable: true
      }));
      // Actualizar tipos disponibles
      this.updateAvailableControlTypes();
      this.filterControls(); // Aplicar filtro inicial
    }
  }

  /**
   * Filtra los controles según el término de búsqueda y el tipo seleccionado
   */
  filterControls(): void {
    let filtered = [...this.targetContextControls];

    // Filtrar por tipo de control si hay tipos seleccionados
    if (this.selectedControlTypes.length > 0) {
      filtered = filtered.filter(control => 
        this.selectedControlTypes.includes(control.controlType)
      );
    }

    // Filtrar por término de búsqueda si hay uno
    if (this.controlSearchTerm && this.controlSearchTerm.trim() !== '') {
      const searchTerm = this.controlSearchTerm.toLowerCase().trim();
      filtered = filtered.filter(control => {
        return (
          control.name.toLowerCase().includes(searchTerm) ||
          control.friendlyName.toLowerCase().includes(searchTerm) ||
          control.controlType.toLowerCase().includes(searchTerm) ||
          control.path.toLowerCase().includes(searchTerm)
        );
      });
    }

    this.filteredTargetContextControls = filtered;
    
    // Log para debug
    console.log('filterControls - Total:', this.targetContextControls.length, 
                'Filtrados:', filtered.length,
                'Tipos seleccionados:', this.selectedControlTypes.length,
                'Término búsqueda:', this.controlSearchTerm || '(ninguno)');
  }

  /**
   * Actualiza la lista de tipos de controles disponibles
   */
  updateAvailableControlTypes(): void {
    const types = new Set<string>();
    this.targetContextControls.forEach(control => {
      if (control.controlType) {
        types.add(control.controlType);
      }
    });
    this.availableControlTypes = Array.from(types).sort();
  }

  /**
   * Alterna el filtro de tipo de control
   */
  toggleControlTypeFilter(type: string): void {
    const index = this.selectedControlTypes.indexOf(type);
    if (index === -1) {
      this.selectedControlTypes.push(type);
    } else {
      this.selectedControlTypes.splice(index, 1);
    }
    this.filterControls();
  }

  /**
   * Limpia el filtro de tipo de control
   */
  clearControlTypeFilter(): void {
    this.selectedControlTypes = [];
    this.filterControls();
  }

  /**
   * Obtiene el ícono según el tipo de control
   */
  getControlIcon(controlType: string): string {
    if (controlType.includes('Button')) return 'bi-circle';
    if (controlType.includes('CheckBox')) return 'bi-check-square';
    if (controlType.includes('RadioButton')) return 'bi-record-circle';
    if (controlType.includes('TextField') || controlType.includes('ComboBox')) return 'bi-input-cursor-text';
    if (controlType.includes('Tab')) return 'bi-folder';
    if (controlType.includes('Menu')) return 'bi-list';
    if (controlType.includes('Toolbar')) return 'bi-tools';
    return 'bi-square';
  }

  /**
   * Verifica si un nodo es un contenedor
   */
  isContainerNode(node: FlowNode): boolean {
    if (!node || !node.data) return false;
    
    // Verificar en caché primero
    if (this.containerNodeCache.has(node.id)) {
      return this.containerNodeCache.get(node.id)!;
    }
    
    // Un nodo es contenedor si tiene targetContextKey en sus datos
    const isContainer = !!(node.data.targetContextKey || node.data.containerId);
    this.containerNodeCache.set(node.id, isContainer);
    return isContainer;
  }

  /**
   * Verifica si un nodo tiene sub-acciones
   */
  hasSubActions(node: FlowNode): boolean {
    if (!node || !node.data) return false;
    const subActions = node.data.subActions;
    return Array.isArray(subActions) && subActions.length > 0;
  }

  /**
   * Obtiene los nombres de las sub-acciones de un nodo
   */
  getSubActionNames(node: FlowNode): string[] {
    if (!this.hasSubActions(node)) return [];
    const subActions = node.data.subActions;
    if (Array.isArray(subActions)) {
      return subActions.map((action: any) => {
        if (typeof action === 'string') return action;
        if (action && typeof action === 'object' && action.name) return action.name;
        return String(action);
      });
    }
    return [];
  }

  /**
   * Invalida el caché de un nodo específico
   */
  invalidateNodeCache(nodeId: string): void {
    this.containerNodeCache.delete(nodeId);
  }

  /**
   * Selecciona un control y lo añade al canvas de targetContext dentro de un contenedor
   */
  selectControl(control: any): void {
    if (!this.selectedTargetContext) {
      console.warn('No hay targetContext seleccionado');
      return;
    }

    // Cambiar a la pestaña de targetContext si no está activa
    if (this.activeTab !== 'targetContext') {
      this.activeTab = 'targetContext';
    }

    // Encontrar la clave del flujo correspondiente al FriendlyName seleccionado
    // Prioridad: 1) Mapeo inverso, 2) targetContextData por FriendlyName, 3) Contenedores existentes, 4) Generar clave corta
    let flowContextKey: string | null = null;
    
    // 1. Buscar en el mapeo inverso (FriendlyName -> clave corta)
    const mappedKey = Object.keys(this.targetContextKeyToFriendlyNameMap).find(
      key => this.targetContextKeyToFriendlyNameMap[key] === this.selectedTargetContext
    );
    
    if (mappedKey) {
      flowContextKey = mappedKey.split('::')[0]; // Extraer clave base sin instancia
    } else if (this.targetContextData) {
      // 2. Buscar en targetContextData por FriendlyName (puede ser string o objeto con FriendlyName)
      const foundKey = Object.keys(this.targetContextData).find(key => {
        const context = this.targetContextData[key];
        if (typeof context === 'string') {
          return context === this.selectedTargetContext;
        } else if (typeof context === 'object' && context !== null && context.FriendlyName) {
          return context.FriendlyName === this.selectedTargetContext;
        }
        return false;
      });
      
      if (foundKey) {
        flowContextKey = foundKey.split('::')[0]; // Extraer clave base sin instancia
      } else {
        // 3. Buscar en contenedores existentes
        const existingContainer = this.targetContainers.find(
          c => c.friendlyName === this.selectedTargetContext
        );
        if (existingContainer) {
          flowContextKey = existingContainer.targetContextKey;
        } else {
          // 4. Generar clave corta desde el FriendlyName
          // Intentar crear una clave corta inteligente (ej: "Select Further Settings" -> "SFS")
          flowContextKey = this.generateShortKeyFromFriendlyName(this.selectedTargetContext);
        }
      }
    } else {
      // Si no hay targetContextData, buscar en contenedores existentes
      const existingContainer = this.targetContainers.find(
        c => c.friendlyName === this.selectedTargetContext
      );
      if (existingContainer) {
        flowContextKey = existingContainer.targetContextKey;
      } else {
        // Generar clave corta desde el FriendlyName
        flowContextKey = this.generateShortKeyFromFriendlyName(this.selectedTargetContext);
      }
    }

    let container: TargetContainer | null = null;

    // ===== PRIORIDAD: Si hay un contenedor seleccionado Y corresponde al target context actual =====
    // Verificar que el contenedor seleccionado corresponda al target context actual
    if (this.selectedContainer) {
      // Verificar si el contenedor seleccionado corresponde al target context actual
      const containerFriendlyName = this.selectedContainer.friendlyName;
      const containerTargetKey = this.selectedContainer.targetContextKey;
      
      // Verificar si el contenedor corresponde al selectedTargetContext
      const containerMatches = containerFriendlyName === this.selectedTargetContext ||
        containerTargetKey === flowContextKey;
      
      if (containerMatches) {
        // El contenedor seleccionado corresponde al target context actual, usar ese
        container = this.selectedContainer;
        console.log('Agregando control al contenedor seleccionado (corresponde al target context):', container.fullKey);
      } else {
        // El contenedor seleccionado NO corresponde al target context actual
        // Limpiar la selección y crear un nuevo contenedor
        console.log('El contenedor seleccionado no corresponde al target context actual. Creando nuevo contenedor.');
        console.log('Contenedor seleccionado:', containerFriendlyName, 'Target context:', this.selectedTargetContext);
        this.selectedContainer = null;
        // Continuar con la lógica de crear nuevo contenedor
      }
    }
    
    // Si no hay contenedor válido seleccionado, crear uno nuevo
    if (!container) {
      // Si no hay contenedor seleccionado o es de otro contexto, crear uno nuevo
      // Verificar si ya existe una instancia de este contexto
      const existingContainers = this.targetContainers.filter(
        c => c.targetContextKey === flowContextKey
      );

      // Determinar el número de instancia
      const instanceNumber = existingContainers.length > 0 
        ? Math.max(...existingContainers.map(c => c.instanceNumber)) + 1 
        : 1;

      // Crear nuevo contenedor con instancia
      const friendlyName = this.selectedTargetContext;
      container = this.createTargetContainer(flowContextKey, friendlyName, instanceNumber);
      this.targetContainers.push(container);
      
      // Reorganizar todos los contenedores para evitar superposiciones
      this.arrangeContainers();
      
      // Conectar con el contenedor anterior
      let containerToConnect: TargetContainer | null = null;
      
      if (this.selectedContainer) {
        // Si hay un contenedor seleccionado, conectar con ese
        containerToConnect = this.selectedContainer;
      } else if (this.targetContainers.length > 1) {
        // Si no hay contenedor seleccionado, conectar con el último contenedor (antes de agregar este)
        // El nuevo contenedor está al final, así que tomamos el penúltimo
        containerToConnect = this.targetContainers[this.targetContainers.length - 2];
      }
      
      if (containerToConnect) {
        this.connectContainers(containerToConnect.id, container.id);
      }
      
      // Actualizar colores después de agregar contenedor
      this.updateContainerColors();
    }

    // Agregar control al contenedor
    const controlNode = this.createControlNode(control, container);
    container.controls.push(controlNode);
    this.targetContextNodes.push(controlNode);
    
    // Agregar el step al JSON
    console.log('=== ANTES de addControlToJson ===');
    console.log('container.fullKey:', container.fullKey);
    console.log('container.targetContextKey:', container.targetContextKey);
    console.log('container.instanceNumber:', container.instanceNumber);
    console.log('controlNode.label:', controlNode.label);
    console.log('controlNode.data:', controlNode.data);
    this.addControlToJson(controlNode, container);
    console.log('=== DESPUÉS de addControlToJson ===');
    console.log('stepsData[' + container.fullKey + ']:', this.stepsData?.[container.fullKey]);
    console.log('flowData.steps[' + container.fullKey + ']:', this.flowData?.steps?.[container.fullKey]);
    
    // Agregar log de debugging
    this.addDebugLog('info', `Control agregado: ${controlNode.label}`, {
      container: container.fullKey,
      controlType: controlNode.type,
      action: controlNode.data?.action
    });
    
    // Actualizar tamaño del contenedor (esto también reorganiza los controles)
    this.updateContainerSize(container);
    
    this.selectContainer(container);
    console.log('Control agregado al contenedor:', controlNode);
    
    // Agregar log de debugging
    this.addDebugLog('info', `Control agregado: ${controlNode.label}`, {
      container: container.fullKey,
      controlType: controlNode.type,
      action: controlNode.data?.action
    });
  }
  
  /**
   * Agrega un control al JSON (stepsData y flowData)
   */
  addControlToJson(controlNode: FlowNode, container: TargetContainer): void {
    if (!this.stepsData || !this.flowData) {
      // Inicializar si no existen
      this.stepsData = {};
      if (!this.flowData) {
        this.flowData = {
          $meta: {},
          targetContext: this.targetContextData || {},
          steps: {}
        };
      }
      if (!this.flowData.steps) {
        this.flowData.steps = {};
      }
    }
    
    // Usar fullKey para diferenciar instancias del mismo contexto (ej: "SCAREA::1", "SCAREA::2")
    const containerKey = container.fullKey;
    const stepKey = controlNode.label;
    
    // Crear el objeto step basado en los datos del control
    // El target debe ser el nombre del control (name o friendlyName), NO el path
    // Prioridad: name > friendlyName > label
    const targetName = controlNode.data?.name || controlNode.data?.friendlyName || controlNode.label;
    
    // Determinar la acción: GuiButton siempre debe ser 'click', otros controles pueden ser 'set' o la acción existente
    let action = controlNode.data?.action;
    if (!action) {
      // Si no hay acción definida, determinar según el tipo de control
      const controlType = controlNode.data?.controlType || controlNode.type;
      if (controlType === 'GuiButton' || controlType === 'button') {
        action = 'click';
      } else {
        action = 'set';
      }
    } else if (controlNode.data?.controlType === 'GuiButton' || controlNode.data?.controlType === 'button') {
      // Si es GuiButton, forzar 'click' incluso si tiene otra acción definida
      action = 'click';
    }
    
    const stepData: any = {
      action: action,
      target: targetName // Usar el nombre del control como target (no el path)
    };
    
    // Agregar campos adicionales si existen
    if (controlNode.data?.paramKey !== undefined) stepData.paramKey = controlNode.data.paramKey;
    if (controlNode.data?.operator !== undefined) stepData.operator = controlNode.data.operator;
    if (controlNode.data?.value !== undefined) stepData.value = controlNode.data.value;
    if (controlNode.data?.timeout !== undefined) stepData.timeout = controlNode.data.timeout;
    if (controlNode.data?.next !== undefined) stepData.next = controlNode.data.next;
    if (controlNode.data?.default !== undefined) stepData.default = controlNode.data.default;
    if (controlNode.data?.targetMap !== undefined) stepData.targetMap = controlNode.data.targetMap;
    
    // Inicializar el objeto de steps para este contenedor si no existe
    if (!this.stepsData[containerKey]) {
      this.stepsData[containerKey] = {};
    }
    
    // Agregar el step
    this.stepsData[containerKey][stepKey] = stepData;
    
    // Verificar inmediatamente que se agregó
    if (!this.stepsData[containerKey][stepKey]) {
      console.error('ERROR: No se pudo agregar el step a stepsData!', {
        containerKey,
        stepKey,
        stepsDataContainer: this.stepsData[containerKey]
      });
    }
    
    // Actualizar flowData.steps - HACER COPIA PROFUNDA para evitar problemas de referencia
    if (!this.flowData.steps) {
      this.flowData.steps = {};
    }
    if (!this.flowData.steps[containerKey]) {
      this.flowData.steps[containerKey] = {};
    }
    // Hacer una copia profunda del stepData para evitar problemas de referencia
    this.flowData.steps[containerKey][stepKey] = JSON.parse(JSON.stringify(stepData));
    
    // Verificar inmediatamente que se agregó a flowData.steps
    if (!this.flowData.steps[containerKey]?.[stepKey]) {
      console.error('ERROR: No se pudo agregar el step a flowData.steps!', {
        containerKey,
        stepKey,
        flowDataStepsContainer: this.flowData.steps[containerKey]
      });
    }
    
    // También actualizar targetContext si es necesario (para nuevas instancias)
    if (!this.flowData.targetContext) {
      this.flowData.targetContext = {};
    }
    if (!this.targetContextData) {
      this.targetContextData = {};
    }
    
    // Si es una nueva instancia (fullKey contiene ::), agregar al targetContext
    if (container.instanceNumber > 1 && !this.flowData.targetContext[containerKey]) {
      // Para instancias adicionales, usar el mismo friendlyName que la primera instancia
      const baseFriendlyName = this.flowData.targetContext[container.targetContextKey] || container.friendlyName;
      this.flowData.targetContext[containerKey] = baseFriendlyName;
      // También actualizar targetContextData
      this.targetContextData[containerKey] = baseFriendlyName;
    }
    
    // Asegurar que targetContextData también tenga la entrada para la primera instancia
    if (container.instanceNumber === 1 && !this.targetContextData[container.targetContextKey]) {
      // Si la clave es larga (contiene espacios o es muy larga), generar una clave corta
      const isLongKey = container.targetContextKey.includes(' ') || container.targetContextKey.length > 10;
      if (isLongKey) {
        // Generar clave corta desde el FriendlyName
        const shortKey = this.generateShortKeyFromFriendlyName(container.friendlyName);
        // Verificar que la clave corta no exista ya (para evitar colisiones)
        if (!this.targetContextData[shortKey] && !this.flowData.targetContext[shortKey]) {
          // Usar la clave corta
          this.targetContextData[shortKey] = container.friendlyName;
          this.flowData.targetContext[shortKey] = container.friendlyName;
          // Actualizar el contenedor para usar la clave corta
          container.targetContextKey = shortKey;
          container.fullKey = container.instanceNumber > 1 ? `${shortKey}::${container.instanceNumber}` : shortKey;
          // Actualizar el containerKey usado en steps
          const newContainerKey = container.fullKey;
          if (newContainerKey !== containerKey && this.stepsData[containerKey]) {
            // Mover los steps a la nueva clave
            this.stepsData[newContainerKey] = this.stepsData[containerKey];
            delete this.stepsData[containerKey];
            if (this.flowData.steps) {
              this.flowData.steps[newContainerKey] = this.flowData.steps[containerKey];
              delete this.flowData.steps[containerKey];
            }
          }
        } else {
          // La clave corta ya existe, usar la clave original pero como string simple
          this.targetContextData[container.targetContextKey] = container.friendlyName;
          this.flowData.targetContext[container.targetContextKey] = container.friendlyName;
        }
      } else {
        // Clave corta: guardar como string simple
        this.targetContextData[container.targetContextKey] = container.friendlyName;
        this.flowData.targetContext[container.targetContextKey] = container.friendlyName;
      }
    }
    
    // Actualizar los campos next de todos los controles en el contenedor
    this.updateNextFields(container);
    
    // Actualizar flowCode para reflejar los cambios
    // IMPORTANTE: Hacer una copia profunda de flowData antes de stringify para asegurar que todos los cambios estén incluidos
    const flowDataCopy = JSON.parse(JSON.stringify(this.flowData));
    this.flowCode = JSON.stringify(flowDataCopy, null, 2);
    
    // Verificar que flowCode contiene el step agregado
    try {
      const parsedFlowCode = JSON.parse(this.flowCode);
      if (!parsedFlowCode.steps?.[containerKey]?.[stepKey]) {
        console.error('ERROR: flowCode no contiene el step agregado después de actualizar!', {
          containerKey,
          stepKey,
          flowCodeSteps: parsedFlowCode.steps?.[containerKey]
        });
      } else {
        console.log('✓ flowCode actualizado correctamente con el step:', containerKey, stepKey);
      }
    } catch (e) {
      console.error('ERROR: No se pudo parsear flowCode después de actualizar:', e);
    }
    
    // Logging detallado para debug
    console.log('=== Step agregado al JSON ===');
    console.log('containerKey:', containerKey);
    console.log('stepKey:', stepKey);
    console.log('stepData:', JSON.parse(JSON.stringify(stepData)));
    console.log('stepsData[' + containerKey + ']:', this.stepsData[containerKey]);
    console.log('flowData.steps[' + containerKey + ']:', this.flowData.steps?.[containerKey]);
    console.log('Verificando si se agregó correctamente:');
    console.log('  - stepsData[' + containerKey + '][' + stepKey + ']:', this.stepsData[containerKey]?.[stepKey]);
    console.log('  - flowData.steps[' + containerKey + '][' + stepKey + ']:', this.flowData.steps?.[containerKey]?.[stepKey]);
    console.log('===========================');
  }
  
  /**
   * Actualiza los campos next de todos los controles basándose en su orden
   */
  updateNextFields(container: TargetContainer): void {
    if (!this.stepsData || !this.flowData || !this.flowData.steps) {
      return;
    }
    
    // Usar fullKey para diferenciar instancias del mismo contexto
    const containerKey = container.fullKey;
    const steps = this.stepsData[containerKey];
    if (!steps) {
      return;
    }
    
    // Actualizar next dentro del contenedor
    for (let i = 0; i < container.controls.length; i++) {
      const currentControl = container.controls[i];
      const currentStepKey = currentControl.label;
      
      if (!steps[currentStepKey]) {
        continue;
      }
      
      // No actualizar next si es una condición (tiene true/false en lugar de next)
      if (steps[currentStepKey].action === 'condition') {
        // Las condiciones tienen true y false, no next, así que las saltamos
        continue;
      }
      
      // Si hay un siguiente control en el mismo contenedor
      if (i < container.controls.length - 1) {
        const nextControl = container.controls[i + 1];
        const nextStepKey = nextControl.label;
        steps[currentStepKey].next = nextStepKey;
      } else {
        // Es el último control del contenedor, verificar si hay un siguiente contenedor
        const containerIndex = this.targetContainers.findIndex(c => c.id === container.id);
        if (containerIndex >= 0 && containerIndex < this.targetContainers.length - 1) {
          // Hay un siguiente contenedor
          const nextContainer = this.targetContainers[containerIndex + 1];
          if (nextContainer.controls.length > 0) {
            // Apuntar al primer control del siguiente contenedor
            const firstNextControl = nextContainer.controls[0];
            const nextContainerKey = nextContainer.fullKey;
            const firstNextStepKey = firstNextControl.label;
            steps[currentStepKey].next = `${nextContainerKey}.${firstNextStepKey}`;
          } else {
            // El siguiente contenedor está vacío, remover next
            if (steps[currentStepKey].next) {
              delete steps[currentStepKey].next;
            }
          }
        } else {
          // Es el último control del último contenedor, remover next si existe
          if (steps[currentStepKey].next) {
            delete steps[currentStepKey].next;
          }
        }
      }
      
      // Actualizar también en flowData.steps
      if (this.flowData.steps[containerKey] && this.flowData.steps[containerKey][currentStepKey]) {
        if (steps[currentStepKey].next) {
          this.flowData.steps[containerKey][currentStepKey].next = steps[currentStepKey].next;
        } else if (this.flowData.steps[containerKey][currentStepKey].next) {
          delete this.flowData.steps[containerKey][currentStepKey].next;
        }
      }
    }
    
    // Actualizar flowCode para reflejar los cambios
    this.flowCode = JSON.stringify(this.flowData, null, 2);
  }

  /**
   * Crea un nuevo contenedor de target
   * Nota: Las posiciones x, y se establecerán por arrangeContainers()
   */
  createTargetContainer(targetContextKey: string, friendlyName: string, instanceNumber: number = 1): TargetContainer {
    // Generar clave completa con instancia (ej: "SCAREA::1")
    const fullKey = instanceNumber > 1 ? `${targetContextKey}::${instanceNumber}` : targetContextKey;
    
    // Asegurar que friendlyName nunca esté vacío
    const finalFriendlyName = (friendlyName && friendlyName.trim()) ? friendlyName.trim() : targetContextKey;
    
    const container: TargetContainer = {
      id: `container_${fullKey}_${Date.now()}`,
      targetContextKey: targetContextKey,
      instanceNumber: instanceNumber,
      fullKey: fullKey,
      friendlyName: finalFriendlyName,
      x: 0, // Se establecerá por arrangeContainers()
      y: 0, // Se establecerá por arrangeContainers()
      width: 250, // Ancho inicial, se ajustará por updateContainerSize()
      height: 100, // Altura inicial, se ajustará por updateContainerSize()
      controls: [],
      isCollapsed: false,
      colorClass: '' // Se asignará dinámicamente por updateContainerColors()
    };
    
    return container;
  }

  /**
   * Conecta dos contenedores con una flecha (flujo unidireccional)
   */
  connectContainers(sourceContainerId: string, targetContainerId: string): void {
    // Verificar que no exista ya esta conexión
    const existingConnection = this.containerConnections.find(
      conn => conn.sourceId === sourceContainerId && conn.targetId === targetContainerId
    );
    
    if (!existingConnection) {
      this.containerConnections.push({
        sourceId: sourceContainerId,
        targetId: targetContainerId
      });
      
      // Actualizar el contenedor fuente para que apunte al siguiente
      const sourceContainer = this.targetContainers.find(c => c.id === sourceContainerId);
      if (sourceContainer) {
        sourceContainer.nextContainerId = targetContainerId;
      }
    }
  }

  /**
   * Desconecta dos contenedores
   */
  disconnectContainers(sourceContainerId: string, targetContainerId: string): void {
    const index = this.containerConnections.findIndex(
      conn => conn.sourceId === sourceContainerId && conn.targetId === targetContainerId
    );
    
    if (index !== -1) {
      this.containerConnections.splice(index, 1);
      
      // Limpiar referencia en el contenedor fuente
      const sourceContainer = this.targetContainers.find(c => c.id === sourceContainerId);
      if (sourceContainer && sourceContainer.nextContainerId === targetContainerId) {
        sourceContainer.nextContainerId = undefined;
      }
    }
  }

  /**
   * Genera conexiones automáticas entre contenedores basadas en el orden en targetContext
   */
  generateContainerConnections(): void {
    // Limpiar conexiones anteriores
    this.containerConnections = [];
    
    if (this.targetContainers.length < 2) {
      console.log('generateContainerConnections - No hay suficientes contenedores para conectar');
      return; // No hay suficientes contenedores para conectar
    }
    
    // Generar conexiones secuenciales entre contenedores
    // Los contenedores se conectan en el orden en que aparecen en targetContext
    for (let i = 0; i < this.targetContainers.length - 1; i++) {
      const sourceContainer = this.targetContainers[i];
      const targetContainer = this.targetContainers[i + 1];
      
      // Conectar el contenedor actual con el siguiente
      this.containerConnections.push({
        sourceId: sourceContainer.id,
        targetId: targetContainer.id
      });
      
      // También establecer nextContainerId para referencia
      sourceContainer.nextContainerId = targetContainer.id;
    }
    
    console.log('generateContainerConnections - Conexiones generadas:', this.containerConnections.length);
    console.log('generateContainerConnections - Detalles:', this.containerConnections);
  }
  
  /**
   * TrackBy function para las conexiones (mejora rendimiento)
   */
  trackByConnection(index: number, conn: { sourceId: string; targetId: string }): string {
    return `${conn.sourceId}-${conn.targetId}`;
  }
  
  /**
   * Obtiene el path SVG para una conexión entre contenedores
   */
  getPathForContainerConnection(sourceId: string, targetId: string): string {
    const sourceContainer = this.targetContainers.find(c => c.id === sourceId);
    const targetContainer = this.targetContainers.find(c => c.id === targetId);
    
    if (!sourceContainer || !targetContainer) {
      console.warn('getPathForContainerConnection - Contenedor no encontrado:', { sourceId, targetId });
      return '';
    }
    
    // Calcular puntos de inicio y fin (considerando el centro vertical del contenedor)
    const startX = sourceContainer.x + sourceContainer.width;
    const startY = sourceContainer.y + (sourceContainer.height / 2);
    const endX = targetContainer.x;
    const endY = targetContainer.y + (targetContainer.height / 2);
    
    // Crear curva suave con puntos de control mejorados
    const distance = endX - startX;
    const controlOffset = Math.min(distance * 0.4, 100); // Offset máximo de 100px
    
    const controlPoint1X = startX + controlOffset;
    const controlPoint1Y = startY;
    const controlPoint2X = endX - controlOffset;
    const controlPoint2Y = endY;
    
    const path = `M ${startX} ${startY} C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${endX} ${endY}`;
    
    return path;
  }

  /**
   * Actualiza los colores de los contenedores dinámicamente
   * El primer y último contenedor tienen colores distintos
   */
  updateContainerColors(): void {
    if (this.targetContainers.length === 0) return;
    
    this.targetContainers.forEach((container, index) => {
      const totalContainers = this.targetContainers.length;
      
      if (totalContainers === 1) {
        // Si solo hay un contenedor, usar color especial
        container.colorClass = 'container-single';
      } else if (index === 0) {
        // Primer contenedor
        container.colorClass = 'container-first';
      } else if (index === totalContainers - 1) {
        // Último contenedor
        container.colorClass = 'container-last';
      } else {
        // Contenedores intermedios
        container.colorClass = 'container-middle';
      }
    });
  }

  /**
   * Crea un nodo de control dentro de un contenedor
   */
  createControlNode(control: any, container: TargetContainer): FlowNode {
    // Construir objeto data con todos los campos del control/paso
    // El target debe ser el nombre del control (name o friendlyName), NO el path
    // El path se guarda por separado pero no se usa en el JSON final como target
    const controlName = control.name || control.friendlyName || control.Id || control.id || '';
    
    // Determinar la acción: GuiButton siempre debe ser 'click', otros controles pueden ser 'set' o la acción existente
    let action = control.action;
    if (!action) {
      const controlType = control.controlType || 'GuiControl';
      if (controlType === 'GuiButton' || controlType === 'button') {
        action = 'click';
      } else {
        action = 'set';
      }
    } else if (control.controlType === 'GuiButton' || control.controlType === 'button') {
      // Si es GuiButton, forzar 'click' incluso si tiene otra acción definida
      action = 'click';
    }
    
    const nodeData: any = {
      action: action,
      target: controlName, // Usar el nombre del control como target (no el path)
      controlType: control.controlType || 'GuiControl',
      path: control.path || control.Id || control.id || '', // Guardar el path por separado
      targetContextKey: container.targetContextKey,
      friendlyName: control.friendlyName || control.name || controlName,
      name: controlName, // Guardar también el name por separado
      containerId: container.id
    };
    
    // Agregar campos adicionales del paso si existen
    if (control.paramKey !== undefined) nodeData.paramKey = control.paramKey;
    if (control.operator !== undefined) nodeData.operator = control.operator;
    if (control.value !== undefined) nodeData.value = control.value;
    if (control.timeout !== undefined) nodeData.timeout = control.timeout;
    if (control.next !== undefined) nodeData.next = control.next;
    if (control.default !== undefined) nodeData.default = control.default;
    if (control.targetMap !== undefined) nodeData.targetMap = control.targetMap;
    
    // Las posiciones x, y se establecerán por arrangeControlsInContainer
    // Por ahora usar valores temporales que se actualizarán después
    return {
      id: `control_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'action',
      label: control.friendlyName || control.name,
      x: 0, // Se establecerá por arrangeControlsInContainer
      y: 0, // Se establecerá por arrangeControlsInContainer
      data: nodeData
    };
  }

  /**
   * Actualiza el tamaño del contenedor basado en sus controles
   */
  updateContainerSize(container: TargetContainer): void {
    this.updateContainerSizeWithoutArranging(container);
    // Reorganizar controles dentro del contenedor después de actualizar el tamaño
    this.arrangeControlsInContainer(container);
  }
  
  /**
   * Actualiza el tamaño del contenedor sin reorganizar los controles
   * Útil cuando el contenedor aún no tiene su posición final
   */
  updateContainerSizeWithoutArranging(container: TargetContainer): void {
    const headerHeight = 40; // Altura del header del contenedor
    
    if (container.controls.length === 0) {
      container.width = 250;
      container.height = headerHeight + 60; // Header + altura mínima del body
      return;
    }

    const controlWidth = 180;
    const controlHeight = 80;
    const spacing = 80; // Espaciado entre controles (punto medio)
    const padding = 15;
    
    const maxWidth = controlWidth + (padding * 2);
    const totalControlsHeight = container.controls.length * (controlHeight + spacing) - spacing;
    const totalHeight = headerHeight + totalControlsHeight + (padding * 2);
    
    container.width = Math.max(maxWidth, 250);
    container.height = Math.max(totalHeight, 120);
  }

  /**
   * Organiza los controles dentro del contenedor de forma vertical ordenada
   */
  arrangeControlsInContainer(container: TargetContainer): void {
    if (container.controls.length === 0) {
      return;
    }
    
    const controlWidth = 180;
    const controlHeight = 80; // Altura reducida para mejor organización
    const padding = 15;
    const spacing = 80; // Espaciado entre controles (punto medio, debe coincidir con updateContainerSize y createControlNode)
    const headerHeight = 40; // Altura del header del contenedor
    
    // Organizar controles verticalmente dentro del contenedor
    // IMPORTANTE: Las coordenadas deben ser absolutas (no relativas) porque el HTML usa control.x - container.x
    container.controls.forEach((control, index) => {
      // Coordenadas absolutas del canvas
      control.x = container.x + padding;
      control.y = container.y + headerHeight + padding + (index * (controlHeight + spacing));
    });
  }

  /**
   * Selecciona un contenedor
   */
  selectContainer(container: TargetContainer): void {
    this.selectedContainer = container;
  }

  /**
   * Elimina un contenedor y todos sus controles
   */
  deleteContainer(containerId: string): void {
    const container = this.targetContainers.find(c => c.id === containerId);
    if (!container) return;

    // Eliminar todos los controles del contenedor
    container.controls.forEach(control => {
      const index = this.targetContextNodes.findIndex(n => n.id === control.id);
      if (index !== -1) {
        this.targetContextNodes.splice(index, 1);
      }
    });

    // ===== ELIMINAR DEL JSON =====
    // Eliminar el contenedor del targetContext y steps
    const containerKey = container.fullKey;
    const baseKey = container.targetContextKey;
    
    // Eliminar de targetContext
    if (this.targetContextData && this.targetContextData[containerKey]) {
      delete this.targetContextData[containerKey];
    }
    // También eliminar la clave base si es la primera instancia
    if (container.instanceNumber === 1 && this.targetContextData && this.targetContextData[baseKey]) {
      delete this.targetContextData[baseKey];
    }
    
    // Eliminar de flowData.targetContext
    if (this.flowData && this.flowData.targetContext) {
      if (this.flowData.targetContext[containerKey]) {
        delete this.flowData.targetContext[containerKey];
      }
      if (container.instanceNumber === 1 && this.flowData.targetContext[baseKey]) {
        delete this.flowData.targetContext[baseKey];
      }
    }
    
    // Eliminar de steps
    if (this.stepsData && this.stepsData[containerKey]) {
      delete this.stepsData[containerKey];
    }
    if (this.flowData && this.flowData.steps && this.flowData.steps[containerKey]) {
      delete this.flowData.steps[containerKey];
    }
    
    // Actualizar flowCode
    if (this.flowData) {
      this.flowCode = JSON.stringify(this.flowData, null, 2);
    }
    // ===== FIN ELIMINAR DEL JSON =====

    // Eliminar el contenedor visualmente
    const containerIndex = this.targetContainers.findIndex(c => c.id === containerId);
    if (containerIndex !== -1) {
      // Eliminar todas las conexiones relacionadas con este contenedor
      this.containerConnections = this.containerConnections.filter(
        conn => conn.sourceId !== containerId && conn.targetId !== containerId
      );
      
      this.targetContainers.splice(containerIndex, 1);
      // Actualizar colores después de eliminar contenedor
      this.updateContainerColors();
    }

    if (this.selectedContainer?.id === containerId) {
      this.selectedContainer = null;
    }
  }

  /**
   * Mueve un contenedor y todos sus controles
   */
  moveContainer(container: TargetContainer, newX: number, newY: number): void {
    const deltaX = newX - container.x;
    const deltaY = newY - container.y;

    container.x = this.snapToGrid(newX);
    container.y = this.snapToGrid(newY);

    // Mover todos los controles relativamente
    container.controls.forEach(control => {
      control.x += deltaX;
      control.y += deltaY;
    });
  }

  /**
   * Inicia el arrastre de un contenedor
   */
  onContainerDragStart(event: DragEvent, container: TargetContainer): void {
    if (event.dataTransfer) {
      event.dataTransfer.setData('containerId', container.id);
      event.dataTransfer.setData('isContainer', 'true');
      event.dataTransfer.effectAllowed = 'move';
      this.isDraggingContainer = true;
      this.draggedContainer = container;
      this.selectedContainer = container;
      
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const canvas = this.elementRef.nativeElement.querySelector('.flow-canvas');
      if (canvas) {
        const canvasRect = canvas.getBoundingClientRect();
        this.dragContainerOffset.x = event.clientX - rect.left;
        this.dragContainerOffset.y = event.clientY - rect.top;
      }
      
      // Agregar clase visual al contenedor que se está arrastrando
      if (event.target) {
        const containerElement = (event.currentTarget as HTMLElement).closest('.target-container');
        if (containerElement) {
          containerElement.classList.add('dragging');
        }
      }
    }
    event.stopPropagation();
  }
  
  /**
   * Maneja el dragover sobre un contenedor (para reordenar)
   */
  onContainerDragOver(event: DragEvent, container: TargetContainer): void {
    // Si se está arrastrando un control, no procesar aquí (dejar que el control lo maneje)
    if (this.draggedControl && !this.draggedContainer) {
      return;
    }
    
    // Solo procesar si se está arrastrando un contenedor
    if (!this.draggedContainer || this.draggedContainer.id === container.id) {
      return;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    
    // Guardar el contenedor sobre el que se está pasando
    this.dragOverContainer = container;
    
    // Agregar clase visual
    const containerElement = event.currentTarget as HTMLElement;
    if (containerElement) {
      containerElement.classList.add('drag-over-container');
    }
  }
  
  /**
   * Maneja el dragleave de un contenedor
   */
  onContainerDragLeave(event: DragEvent): void {
    // Remover clase visual
    const containerElement = event.currentTarget as HTMLElement;
    if (containerElement) {
      containerElement.classList.remove('drag-over-container');
    }
    
    // Limpiar dragOverContainer si salimos del contenedor
    const relatedTarget = event.relatedTarget as HTMLElement;
    if (!relatedTarget || !containerElement.contains(relatedTarget)) {
      this.dragOverContainer = null;
    }
  }
  
  /**
   * Maneja el drop de un contenedor sobre otro (reordenar)
   */
  onContainerDrop(event: DragEvent, targetContainer: TargetContainer): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    
    if (!this.draggedContainer || this.draggedContainer.id === targetContainer.id) {
      this.resetContainerDragState();
      return;
    }
    
    // Remover clase visual
    const containerElement = event.currentTarget as HTMLElement;
    if (containerElement) {
      containerElement.classList.remove('drag-over-container');
    }
    
    // Encontrar índices de los contenedores
    const draggedIndex = this.targetContainers.findIndex(c => c.id === this.draggedContainer!.id);
    const targetIndex = this.targetContainers.findIndex(c => c.id === targetContainer.id);
    
    if (draggedIndex === -1 || targetIndex === -1) {
      this.resetContainerDragState();
      return;
    }
    
    // Reordenar los contenedores en el array
    const containers = [...this.targetContainers];
    const [removed] = containers.splice(draggedIndex, 1);
    containers.splice(targetIndex, 0, removed);
    
    // Actualizar el array de contenedores
    this.targetContainers = containers;
    
    // IMPORTANTE: Actualizar el JSON PRIMERO para que arrangeContainers() use el nuevo orden
    this.updateContainersOrderInJson();
    
    // Reorganizar posiciones visuales (ahora respetará el nuevo orden del JSON)
    this.arrangeContainers();
    
    // Regenerar conexiones basadas en el nuevo orden
    this.generateContainerConnections();
    
    // Actualizar todos los campos next después de reordenar contenedores
    this.targetContainers.forEach(container => {
      this.updateNextFields(container);
    });
    
    this.resetContainerDragState();
  }
  
  /**
   * Resetea el estado del drag and drop de contenedores
   */
  resetContainerDragState(): void {
    this.draggedContainer = null;
    this.dragOverContainer = null;
    this.isDraggingContainer = false;
    
    // Remover clases visuales
    document.querySelectorAll('.target-container.dragging').forEach(el => {
      el.classList.remove('dragging');
    });
    document.querySelectorAll('.target-container.drag-over-container').forEach(el => {
      el.classList.remove('drag-over-container');
    });
  }
  
  /**
   * Actualiza el orden de los contenedores en el JSON
   */
  updateContainersOrderInJson(): void {
    if (!this.flowData) {
      return;
    }
    
    // Crear un nuevo objeto targetContext con el orden actualizado
    const orderedTargetContext: any = {};
    const orderedSteps: any = {};
    
    // Iterar sobre los contenedores en su nuevo orden
    this.targetContainers.forEach(container => {
      // Usar fullKey para diferenciar instancias del mismo contexto
      const key = container.fullKey;
      const baseKey = container.targetContextKey;
      
      // Agregar al targetContext en el nuevo orden
      // Si es la primera instancia, usar la clave base
      // Si es una instancia adicional, usar fullKey (ej: "KSCLI::2")
      if (container.instanceNumber === 1) {
        // Primera instancia: usar clave base
        if (this.targetContextData && this.targetContextData[baseKey]) {
          orderedTargetContext[baseKey] = this.targetContextData[baseKey];
        } else if (this.targetContextData && this.targetContextData[key]) {
          // Si existe con fullKey, usar ese valor pero con clave base
          orderedTargetContext[baseKey] = this.targetContextData[key];
        } else {
          // Crear nueva entrada con friendlyName
          orderedTargetContext[baseKey] = container.friendlyName;
        }
      } else {
        // Instancia adicional: usar fullKey (ej: "KSCLI::2")
        // Obtener el friendlyName de la primera instancia o usar el del contenedor actual
        const baseValue = this.targetContextData?.[baseKey];
        const friendlyName = typeof baseValue === 'string' 
          ? baseValue 
          : (baseValue?.FriendlyName || container.friendlyName);
        
        orderedTargetContext[key] = friendlyName;
      }
      
      // Agregar los steps correspondientes en el nuevo orden
      // Para steps, siempre usar fullKey para diferenciar instancias
      // ===== PRESERVAR CONTENEDORES VACÍOS =====
      // Siempre crear una entrada en steps, incluso si está vacía, para preservar instancias
      if (this.stepsData && this.stepsData[key]) {
        orderedSteps[key] = this.stepsData[key];
      } else if (this.stepsData && container.instanceNumber === 1 && this.stepsData[baseKey]) {
        // Si es la primera instancia y existe con baseKey, usar ese
        orderedSteps[baseKey] = this.stepsData[baseKey];
      } else {
        // Si no hay steps, crear una entrada vacía para preservar el contenedor
        // Esto es importante para instancias como KSCLI::2 que pueden quedar vacías temporalmente
        orderedSteps[key] = {};
      }
      // ===== FIN PRESERVAR CONTENEDORES VACÍOS =====
    });
    
    // Actualizar targetContextData y flowData
    this.targetContextData = orderedTargetContext;
    if (this.flowData.targetContext) {
      this.flowData.targetContext = orderedTargetContext;
    }
    
    // Actualizar stepsData y flowData.steps
    if (this.stepsData) {
      this.stepsData = orderedSteps;
    }
    if (this.flowData.steps) {
      this.flowData.steps = orderedSteps;
    }
    
    // Actualizar flowCode para reflejar los cambios
    this.flowCode = JSON.stringify(this.flowData, null, 2);
  }

  /**
   * Selecciona un nodo de targetContext
   */
  selectTargetContextNode(node: FlowNode): void {
    this.selectedTargetContextNode = node;
  }

  /**
   * Elimina un nodo de targetContext
   */
  deleteTargetContextNode(): void {
    if (this.selectedTargetContextNode) {
      const node = this.selectedTargetContextNode;
      const container = this.targetContainers.find(c => c.id === node.data?.containerId);
      
      if (container) {
        this.deleteControlFromContainer(node, container);
      } else {
        const index = this.targetContextNodes.findIndex(n => n.id === node.id);
        if (index !== -1) {
          this.targetContextNodes.splice(index, 1);
        }
      }
      
      this.selectedTargetContextNode = null;
    }
  }

  /**
   * Elimina un control de un contenedor
   */
  deleteControlFromContainer(control: FlowNode, container: TargetContainer): void {
    const controlIndex = container.controls.findIndex(c => c.id === control.id);
    if (controlIndex !== -1) {
      container.controls.splice(controlIndex, 1);
    }

    const nodeIndex = this.targetContextNodes.findIndex(n => n.id === control.id);
    if (nodeIndex !== -1) {
      this.targetContextNodes.splice(nodeIndex, 1);
    }
    
    // Agregar log de debugging
    this.addDebugLog('info', `Control eliminado: ${control.label}`, {
      container: container.fullKey,
      controlType: control.type
    });

    // ===== ELIMINAR DEL JSON =====
    // Eliminar el step del JSON usando el fullKey del contenedor y el label del control
    const containerKey = container.fullKey;
    const stepKey = control.label;
    
    if (this.stepsData && this.stepsData[containerKey]) {
      if (this.stepsData[containerKey][stepKey]) {
        delete this.stepsData[containerKey][stepKey];
        // Si el contenedor queda sin steps, eliminar la entrada completa
        if (Object.keys(this.stepsData[containerKey]).length === 0) {
          delete this.stepsData[containerKey];
        }
      }
    }
    
    // También eliminar de flowData.steps
    if (this.flowData && this.flowData.steps && this.flowData.steps[containerKey]) {
      if (this.flowData.steps[containerKey][stepKey]) {
        delete this.flowData.steps[containerKey][stepKey];
        // Si el contenedor queda sin steps, eliminar la entrada completa
        if (Object.keys(this.flowData.steps[containerKey]).length === 0) {
          delete this.flowData.steps[containerKey];
        }
      }
    }
    
    // Actualizar los campos next de los controles restantes
    this.updateNextFields(container);
    
    // Actualizar flowCode para reflejar los cambios
    if (this.flowData) {
      this.flowCode = JSON.stringify(this.flowData, null, 2);
    }
    // ===== FIN ELIMINAR DEL JSON =====

    // Actualizar tamaño del contenedor
    this.updateContainerSize(container);
    
    // Reorganizar controles restantes
    this.arrangeControlsInContainer(container);

    // ===== NO ELIMINAR AUTOMÁTICAMENTE EL CONTENEDOR =====
    // No eliminar el contenedor automáticamente cuando queda vacío.
    // Esto permite mantener instancias (como KSCLI::2) aunque no tengan controles.
    // El contenedor solo se eliminará si el usuario lo hace explícitamente con el botón X.
    // if (container.controls.length === 0) {
    //   this.deleteContainer(container.id);
    // }
    // ===== FIN NO ELIMINAR AUTOMÁTICAMENTE =====
  }

  /**
   * Genera contenedores visuales desde targetContextData
   */
  generateTargetContextNodes(): void {
    this.targetContextNodes = [];
    this.targetContainers = [];
    
    if (!this.targetContextData) {
      return;
    }
    
    // ===== RESPETAR EL ORDEN DEL JSON =====
    // Usar las claves en el orden que aparecen en el JSON (no agrupar por baseKey)
    const keys = Object.keys(this.targetContextData);
    
    // Procesar cada clave en el orden del JSON
    keys.forEach((key) => {
        const context = this.targetContextData[key];
        
        // Saltar si el contexto es null o undefined
        if (context === null || context === undefined) {
          return;
        }
        
        // Detectar si la clave tiene instancia (ej: "SCAREA::1", "SCAREA::2")
        const instanceMatch = key.match(/^(.+)::(\d+)$/);
        let baseKey: string;
        let instanceNumber: number;
        
        if (instanceMatch) {
          baseKey = instanceMatch[1];
          instanceNumber = parseInt(instanceMatch[2], 10);
        } else {
          baseKey = key;
          instanceNumber = 1; // Primera instancia si no tiene ::
        }
        
        let friendlyName: string;
        
        // Si el contexto es un string, usar ese string como FriendlyName
        if (typeof context === 'string') {
          friendlyName = context.trim() || baseKey; // Si el string está vacío, usar la baseKey
        } else if (typeof context === 'object' && context !== null && context.FriendlyName) {
          friendlyName = context.FriendlyName.trim() || baseKey; // Si FriendlyName está vacío, usar la baseKey
        } else {
          friendlyName = baseKey; // Usar la baseKey como fallback
        }
        
        // Asegurar que siempre haya un nombre (nunca debería estar vacío en este punto)
        if (!friendlyName || friendlyName.trim() === '') {
          friendlyName = baseKey;
        }
        
        // Crear contenedor con el número de instancia correcto
        const container = this.createTargetContainer(baseKey, friendlyName, instanceNumber);
        this.targetContainers.push(container);
        
        // Procesar deepaliases si existen para crear controles dentro del contenedor
        // Solo procesar si el contexto es un objeto (no un string) y tiene deepaliases
        if (typeof context === 'object' && context !== null && context.deepaliases) {
        const deepAliases = context.deepaliases;
        const aliasKeys = Object.keys(deepAliases);
        
        aliasKeys.forEach((aliasName) => {
          const aliasPath = deepAliases[aliasName];
          
          // Crear objeto de control desde el deepalias
          const control = {
            name: aliasName,
            friendlyName: aliasName,
            controlType: this.inferControlTypeFromPath(aliasPath),
            path: aliasPath,
            isManipulable: true
          };
          
          // Crear nodo de control y agregarlo al contenedor
          const controlNode = this.createControlNode(control, container);
          container.controls.push(controlNode);
          this.targetContextNodes.push(controlNode);
        });
        }
        
        // Procesar steps correspondientes a este contenedor
        // Usar la clave completa (key) que puede incluir :: para instancias
        if (this.stepsData && this.stepsData[key]) {
          const containerSteps = this.stepsData[key];
          const stepKeys = Object.keys(containerSteps);
        
        stepKeys.forEach((stepKey) => {
          const step = containerSteps[stepKey];
          
          // Crear objeto de control desde el paso
          // El target del paso es el nombre del control (ej: "CostCenterHigh"), no el path
          // Si step.target es un path (empieza con "/app"), usar stepKey como nombre
          // Si step.target es un nombre (no empieza con "/app"), usar step.target como nombre
          const isPath = step.target && step.target.startsWith('/app');
          const controlName = isPath ? stepKey : (step.target || stepKey);
          
          // Inferir el tipo de control desde el path si está disponible
          const inferredControlType = step.target && step.target.startsWith('/app') 
            ? this.inferControlTypeFromPath(step.target)
            : (step.controlType || 'GuiControl');
          
          // Corregir la acción: GuiButton siempre debe ser 'click'
          let stepAction = step.action || 'set';
          if (inferredControlType === 'GuiButton' || step.controlType === 'GuiButton') {
            stepAction = 'click';
          }
          
          const control = {
            name: controlName, // Usar el nombre del control, no el path
            friendlyName: stepKey, // El friendlyName es el nombre del paso
            controlType: inferredControlType, // Usar el tipo inferido del path o del step
            path: isPath ? step.target : '', // Guardar el path solo si es un path real
            action: stepAction, // Usar la acción corregida (click para GuiButton)
            paramKey: step.paramKey,
            operator: step.operator,
            value: step.value,
            timeout: step.timeout,
            next: step.next,
            default: step.default,
            targetMap: step.targetMap,
            target: controlName, // Guardar el target como nombre del control
            isManipulable: true
          };
          
          // Crear nodo de control y agregarlo al contenedor
          const controlNode = this.createControlNode(control, container);
          container.controls.push(controlNode);
          this.targetContextNodes.push(controlNode);
        });
        }
        
        // Actualizar tamaño del contenedor después de agregar controles
        // NO reorganizar controles aquí porque el contenedor aún no tiene su posición final
        this.updateContainerSizeWithoutArranging(container);
    });
    
    // Resetear zoom y pan antes de organizar
    this.zoomLevel = 1;
    this.panOffsetX = 0;
    this.panOffsetY = 0;
    
    // Organizar contenedores en grid (esto también reorganiza los controles dentro de cada contenedor)
    this.arrangeContainers();
    
    // Actualizar colores después de generar todos los contenedores
    this.updateContainerColors();
    
    // Generar conexiones automáticas entre contenedores secuenciales
    this.generateContainerConnections();
    
    // Centrar el canvas en los contenedores después de organizarlos
    setTimeout(() => {
      this.centerCanvasOnContainers();
    }, 200);
  }
  
  /**
   * Centra el canvas en los contenedores visibles
   */
  centerCanvasOnContainers(): void {
    if (this.targetContainers.length === 0) return;
    
    // Calcular el área que ocupan todos los contenedores
    let minX = Number.MAX_VALUE;
    let minY = Number.MAX_VALUE;
    let maxX = Number.MIN_VALUE;
    let maxY = Number.MIN_VALUE;
    
    this.targetContainers.forEach(container => {
      minX = Math.min(minX, container.x);
      minY = Math.min(minY, container.y);
      maxX = Math.max(maxX, container.x + container.width);
      maxY = Math.max(maxY, container.y + container.height);
    });
    
    // Obtener dimensiones del canvas
    const canvasElement = this.elementRef.nativeElement.querySelector('.flow-canvas');
    if (!canvasElement) return;
    
    const canvasWidth = canvasElement.offsetWidth || 1200;
    const canvasHeight = canvasElement.offsetHeight || 800;
    
    // Calcular el centro del área de contenedores
    const containersCenterX = (minX + maxX) / 2;
    const containersCenterY = (minY + maxY) / 2;
    
    // Calcular dimensiones de los contenedores
    const containersWidth = maxX - minX;
    const containersHeight = maxY - minY;
    
    // Ajustar zoom si es necesario para que quepan todos los contenedores
    const margin = 100;
    const availableWidth = canvasWidth - (margin * 2);
    const availableHeight = canvasHeight - (margin * 2);
    
    if (containersWidth > 0 && containersHeight > 0) {
      const scaleX = availableWidth / containersWidth;
      const scaleY = availableHeight / containersHeight;
      const optimalZoom = Math.min(scaleX, scaleY, 1); // No hacer zoom in, solo out si es necesario
      
      if (optimalZoom < this.zoomLevel && optimalZoom > 0.2) {
        this.zoomLevel = Math.max(optimalZoom, 0.3); // Mínimo zoom del 30%
      }
    }
    
    // Calcular offsets para centrar con margen
    this.panOffsetX = (canvasWidth / 2) - (containersCenterX * this.zoomLevel);
    this.panOffsetY = (canvasHeight / 2) - (containersCenterY * this.zoomLevel);
  }

  /**
   * Infiere el tipo de control desde el path
   */
  inferControlTypeFromPath(path: string): string {
    if (!path) return 'GuiControl';
    
    // Detectar tipos comunes de controles SAP GUI desde el path
    if (path.includes('/btn[')) return 'GuiButton';
    if (path.includes('/ctxt')) return 'GuiTextField';
    if (path.includes('/chk')) return 'GuiCheckBox';
    if (path.includes('/radiobtn')) return 'GuiRadioButton';
    if (path.includes('/cmb')) return 'GuiComboBox';
    if (path.includes('/shell')) return 'GuiShell';
    if (path.includes('(Ctrl+') || path.includes('(F')) return 'GuiButton'; // Atajos de teclado
    
    return 'GuiControl';
  }
  
  /**
   * Infiere el tipo de control basado en la acción del paso
   */
  /**
   * Genera una clave corta desde un FriendlyName
   * Ejemplos: "Select Further Settings" -> "SFS", "Display Project Actual Cost Line Items" -> "DPCLI"
   */
  generateShortKeyFromFriendlyName(friendlyName: string): string {
    if (!friendlyName) return '';
    
    // Si ya es una clave corta (menos de 10 caracteres, sin espacios), usarla directamente
    if (friendlyName.length <= 10 && !friendlyName.includes(' ')) {
      return friendlyName.toUpperCase();
    }
    
    // Intentar generar una clave corta desde las iniciales de las palabras importantes
    const words = friendlyName.split(/\s+/);
    let shortKey = '';
    
    // Tomar las primeras letras de cada palabra (máximo 4 palabras para evitar claves muy largas)
    for (let i = 0; i < Math.min(words.length, 4); i++) {
      const word = words[i];
      if (word && word.length > 0) {
        // Tomar la primera letra, pero si la palabra es muy corta (1-2 letras), tomarla completa
        if (word.length <= 2) {
          shortKey += word.toUpperCase();
        } else {
          shortKey += word[0].toUpperCase();
        }
      }
    }
    
    // Si la clave generada es muy corta (menos de 2 caracteres), usar más letras
    if (shortKey.length < 2 && words.length > 0) {
      const firstWord = words[0];
      if (firstWord.length >= 2) {
        shortKey = firstWord.substring(0, Math.min(4, firstWord.length)).toUpperCase();
      }
    }
    
    // Si aún no hay clave válida, usar las primeras letras del FriendlyName
    if (!shortKey || shortKey.length < 2) {
      shortKey = friendlyName.substring(0, Math.min(10, friendlyName.length)).replace(/\s+/g, '').toUpperCase();
    }
    
    return shortKey;
  }

  inferControlTypeFromAction(action: string): string {
    if (!action) return 'GuiControl';
    
    switch (action.toLowerCase()) {
      case 'waitfor':
        return 'GuiWait';
      case 'click':
        return 'GuiButton';
      case 'set':
        return 'GuiTextField';
      case 'condition':
        return 'GuiCondition';
      case 'columns':
        return 'GuiColumns';
      case 'columnssum':
        return 'GuiColumnsSum';
      case 'saveas':
        return 'GuiSaveAs';
      case 'reset':
        return 'GuiReset';
      default:
        return 'GuiControl';
    }
  }

  /**
   * Organiza los contenedores horizontalmente en una sola fila
   */
  arrangeContainers(): void {
    if (this.targetContainers.length === 0) return;
    
    // Empezar más a la derecha para evitar que quede oculto detrás del menú lateral
    // El panel lateral tiene aproximadamente 350px de ancho cuando está abierto
    const startX = 400; // Aumentado de 100 a 400 para dejar espacio para el menú
    const startY = 100;
    const spacingX = 350; // Espaciado horizontal entre contenedores
    
    // Primero, actualizar el tamaño de todos los contenedores
    this.targetContainers.forEach(container => {
      this.updateContainerSize(container);
    });
    
    // ===== RESPETAR EL ORDEN DEL JSON AL ORGANIZAR VISUALMENTE =====
    // Solo reordenar según el JSON cuando se carga inicialmente o cuando se genera desde JSON
    // NO reordenar cuando se llama después de un drag and drop (el orden ya está actualizado)
    // Para detectar si debemos reordenar, verificamos si el orden actual coincide con el JSON
    if (this.targetContextData && this.targetContainers.length > 0) {
      const jsonKeys = Object.keys(this.targetContextData);
      
      // Verificar si el orden actual coincide con el orden del JSON
      // Si coincide, no reordenar (respeta el orden del drag and drop)
      // Si no coincide, reordenar según el JSON (carga inicial o generación desde JSON)
      let needsReordering = false;
      
      if (jsonKeys.length === this.targetContainers.length) {
        // Verificar si cada contenedor en su posición actual coincide con la clave del JSON en esa posición
        for (let i = 0; i < jsonKeys.length; i++) {
          const jsonKey = jsonKeys[i];
          const container = this.targetContainers[i];
          
          // Verificar si el contenedor en esta posición corresponde a la clave del JSON
          const containerKey = container.instanceNumber === 1 ? container.targetContextKey : container.fullKey;
          if (containerKey !== jsonKey && container.fullKey !== jsonKey) {
            needsReordering = true;
            break;
          }
        }
      } else {
        needsReordering = true;
      }
      
      // Solo reordenar si es necesario
      if (needsReordering) {
        const orderedContainers: TargetContainer[] = [];
        
        // Crear un mapa de fullKey a contenedor para búsqueda rápida
        const containerMap = new Map<string, TargetContainer>();
        this.targetContainers.forEach(container => {
          containerMap.set(container.fullKey, container);
          // También mapear por baseKey para la primera instancia
          if (container.instanceNumber === 1) {
            containerMap.set(container.targetContextKey, container);
          }
        });
        
        // Ordenar según el orden del JSON
        jsonKeys.forEach(key => {
          const container = containerMap.get(key);
          if (container && !orderedContainers.includes(container)) {
            orderedContainers.push(container);
          }
        });
        
        // Agregar cualquier contenedor que no esté en el JSON (por si acaso)
        this.targetContainers.forEach(container => {
          if (!orderedContainers.includes(container)) {
            orderedContainers.push(container);
          }
        });
        
        // Actualizar el array de contenedores con el orden correcto
        this.targetContainers = orderedContainers;
      }
    }
    // ===== FIN RESPETAR ORDEN =====
    
    // Organizar horizontalmente en una sola fila
    let currentX = startX;
    
    this.targetContainers.forEach((container) => {
      container.x = currentX;
      container.y = startY; // Todos en la misma fila
      
      // Actualizar posiciones de controles dentro del contenedor
      this.arrangeControlsInContainer(container);
      
      // Avanzar la posición X para el siguiente contenedor
      currentX += container.width + spacingX;
    });
    
    // Actualizar colores después de reorganizar
    this.updateContainerColors();
    
    // Regenerar conexiones después de reorganizar los contenedores
    this.generateContainerConnections();
  }
  
  
  // Variables para el acordeón
  accordionState: {[key: string]: boolean} = {
    buttons: true,
    spacing: true,
    types: true,
    filters: false,
    sapControls: false  // Añadir nuevo estado para el acordeón de controles SAP
  };
  
  // Variables para Controles SAP
  availableTargets: Array<{ key: string; friendlyName: string; path: string; flowContextKey?: string }> = [];
  loadingTargets = false;
  targetsJsonData: any = null; // Almacena el JSON completo de los targets cargados
  showTargetsJsonModal: boolean = false; // Controla la visibilidad del modal
  selectedTargetContext: string | null = null;
  selectedTargetPath: string | null = null;
  // Mapeo entre claves del targetContext del flujo y FriendlyName del archivo de targets
  targetContextKeyToFriendlyNameMap: { [flowKey: string]: string } = {};
  targetContextControls: Array<{
    name: string;
    friendlyName: string;
    controlType: string;
    path: string;
    isManipulable: boolean;
  }> = [];
  filteredTargetContextControls: Array<{
    name: string;
    friendlyName: string;
    controlType: string;
    path: string;
    isManipulable: boolean;
  }> = [];
  controlSearchTerm: string = '';
  loadingControls = false;
  
  // Variables para filtros de controles
  selectedControlTypes: string[] = [];
  availableControlTypes: string[] = [];
  
  // Variables para el selector de targets
  currentTcode: string = 'KSB1';
  showTargetSelector: boolean = false;
  selectedTarget: SapTarget | null = null;
  targetSelectorMode: 'edit' | 'create' = 'edit';
  availableTargetsForSelector: SapTarget[] = [];
  
  // Variables para selección de tcode en flujo en blanco
  showTcodeSelector: boolean = false;
  availableTcodes: string[] = []; // Se cargará desde los archivos de targets disponibles
  loadingTcodes: boolean = false;
  selectedTcodeForBlankFlow: string = '';
  
  // Variables para panel de debugging y validación
  showDebugPanel: boolean = false;
  validationResult: ValidationResult | null = null;
  debugLogs: Array<{ timestamp: Date; type: 'info' | 'warning' | 'error'; message: string; data?: any }> = [];
  jsonPreview: string = '';
  jsonBeforeSave: string = '';
  jsonAfterSave: string = '';
  containerErrors: Map<string, string[]> = new Map(); // containerKey -> [error messages]
  
  // Cache para nodos contenedor
  private containerNodeCache: Map<string, boolean> = new Map();
  
  // Variables para el filtro por tipo de control (eliminado)
  filteredFlowNodes: FlowNode[] = [];
  
  private subscriptions: Subscription[] = [];
  
  constructor(
    private flowService: FlowService, 
    private fileService: FileService, 
    private elementRef: ElementRef,
    private sftpService: SftpService,
    private flowValidator: FlowValidatorService
  ) { }

  ngOnInit(): void {
    // Suscribirse a cambios en el flujo actual
    this.subscriptions.push(
      this.flowService.getCurrentFlow().subscribe(flow => {
        if (flow) {
          this.flowNodes = flow.nodes;
          this.filteredFlowNodes = [...this.flowNodes]; // Mostrar todos los nodos
          this.connections = flow.connections;
          
          // Organizar automáticamente los nodos si es la primera carga
          if (this.autoArrangeMode) {
            this.autoArrangeNodes();
          }
          
        }
      })
    );
    
    // Suscribirse a cambios en el nodo seleccionado
    this.subscriptions.push(
      this.flowService.getSelectedNode().subscribe(node => {
        this.selectedNode = node;
      })
    );
    
    // Suscribirse a cambios en el archivo seleccionado
    this.subscriptions.push(
      this.fileService.getSelectedFile().subscribe(file => {
        if (file && file.content && !this.isUpdatingFile) {
          // Si el contenido cambió o el nombre cambió, recargar
          if (file.content !== this.lastImportedContent || file.name !== this.currentFlowFileName) {
            try {
              console.log('FileService - Cargando flujo:', file.name, 'Contenido cambió:', file.content !== this.lastImportedContent);
              this.currentFlowFileName = file.name; // Guardar nombre del flujo
              // importFlowFromJson siempre carga todos los targets disponibles
              this.importFlowFromJson(file.content, file.name);
              this.lastImportedContent = file.content;
              // Actualizar también jsonContent para sincronizar con el input
              if (this.jsonContent !== file.content) {
                this.jsonContent = file.content;
              }
            } catch (error) {
              console.error('Error al cargar el flujo:', error);
            }
          } else {
            console.log('FileService - Flujo ya cargado, omitiendo importación');
          }
        }
      })
    );
    
    // Si se proporciona contenido JSON como entrada, importarlo
    if (this.jsonContent && this.jsonContent.trim() !== '') {
      this.importFlowFromJson(this.jsonContent, 'Flujo importado');
    }
    
    // Detectar teclas para atajos de teclado
    this.setupKeyboardShortcuts();
    
    // Inicializar el acordeón (ya está inicializado en la declaración de la propiedad)
    // No es necesario reinicializarlo aquí
    
    // Cargar los tipos de controles disponibles
    this.loadControlTypes();
    
    // NO cargar targets genéricos aquí porque cuando se carga un flujo,
    // loadTargetsForCurrentFlow se ejecutará y poblará availableTargets con los FriendlyName correctos.
    // Si se carga un flujo, los targets se cargarán desde loadTargetsForCurrentFlow.
    // Si no hay flujo cargado, los targets se cargarán cuando sea necesario.
    // this.loadTargetsFromSftp(); // Comentado: se carga cuando se carga un flujo específico
  }
  
  ngOnChanges(changes: SimpleChanges): void {
    // Detectar cambios en jsonContent
    if (changes['jsonContent'] && !changes['jsonContent'].firstChange) {
      const newContent = changes['jsonContent'].currentValue;
      if (newContent && newContent.trim() !== '' && newContent !== this.lastImportedContent) {
        // Determinar el nombre del flujo basado en el contenido o usar un nombre por defecto
        const flowName = this.currentFlowFileName || 'Flujo importado';
        this.importFlowFromJson(newContent, flowName);
        this.lastImportedContent = newContent;
      }
    }
  }
  
  ngOnDestroy(): void {
    // Cancelar todas las suscripciones al destruir el componente
    this.subscriptions.forEach(sub => sub.unsubscribe());
    
    // Limpiar caché
    this.containerNodeCache.clear();
    
    // Salir del modo pantalla completa si está activo
    if (this.isFullscreen) {
      this.exitFullscreen();
    }
  }
  
  // Configurar atajos de teclado
  setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (event) => {
      // Evitar procesar atajos si estamos en un campo de texto
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      // F11 o Alt+Enter para pantalla completa
      if (event.key === 'F11' || (event.altKey && event.key === 'Enter')) {
        event.preventDefault();
        this.toggleFullscreen();
      }
      
      // Escape para salir de pantalla completa
      if (event.key === 'Escape' && this.isFullscreen) {
        this.exitFullscreen();
      }
      
      // Ctrl+0 para resetear zoom
      if (event.ctrlKey && event.key === '0') {
        event.preventDefault();
        this.resetZoom();
      }
      
      // Ctrl++ para zoom in
      if (event.ctrlKey && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        this.zoomIn();
      }
      
      // Ctrl+- para zoom out
      if (event.ctrlKey && event.key === '-') {
        event.preventDefault();
        this.zoomOut();
      }
      
      // Ctrl+F para buscar nodo (implementar en el futuro)
      if (event.ctrlKey && event.key === 'f') {
        event.preventDefault();
        // Implementar búsqueda de nodos
      }
      
      // Ctrl+G para mostrar/ocultar cuadrícula
      if (event.ctrlKey && event.key === 'g') {
        event.preventDefault();
        this.toggleGrid();
      }
      
      // Ctrl+M para mostrar/ocultar minimap
      if (event.ctrlKey && event.key === 'm') {
        event.preventDefault();
        this.toggleMinimap();
      }
      
      // Ctrl+L para mostrar/ocultar etiquetas
      if (event.ctrlKey && event.key === 'l') {
        event.preventDefault();
        this.toggleNodeLabels();
      }
      
      // Ctrl+D para alternar modo oscuro/claro
      if (event.ctrlKey && event.key === 'd') {
        event.preventDefault();
        this.toggleDarkMode();
      }
      
      // Ctrl+R para organizar automáticamente
      if (event.ctrlKey && event.key === 'r') {
        event.preventDefault();
        this.autoArrangeNodes();
      }
      
      // Ctrl+H para centrar el canvas
      if (event.ctrlKey && event.key === 'h') {
        event.preventDefault();
        this.centerCanvas();
      }
    });
  }
  
  importFlowFromJson(jsonContent: string, name: string): void {
    try {
      this.flowData = JSON.parse(jsonContent);
      // Asegurar que el nombre del flujo esté guardado antes de procesar
      this.currentFlowFileName = name; // Guardar nombre del flujo
      console.log('importFlowFromJson - Nombre del flujo establecido:', name);
      
      // Extraer steps y targetContext
      if (this.flowData.steps) {
        this.stepsData = this.flowData.steps;
      } else {
        this.stepsData = {};
      }
      
      if (this.flowData.targetContext) {
        this.targetContextData = this.flowData.targetContext;
        console.log('importFlowFromJson - targetContext encontrado con', Object.keys(this.targetContextData).length, 'claves');
      } else {
        this.targetContextData = {};
        console.log('importFlowFromJson - No hay targetContext en el flujo');
      }
      
      // Verificar si es un flujo en blanco (sin tcode o sin targetContext)
      const isBlankFlow = !this.flowData.$meta?.tcode || 
                         !this.flowData.targetContext || 
                         Object.keys(this.targetContextData).length === 0;
      
      if (isBlankFlow) {
        console.log('Flujo en blanco detectado, cargando lista de tcodes disponibles');
        this.loadAvailableTcodes();
        this.showTcodeSelector = true;
        this.selectedTcodeForBlankFlow = '';
        // No continuar con la carga normal, esperar a que el usuario seleccione un tcode
        return;
      }
      
      this.flowService.importSapFlow(jsonContent, name);
      this.flowCode = jsonContent;
      
      // Generar nodos visuales para targetContext
      this.generateTargetContextNodes();
      
      // Limpiar estado anterior
      this.availableTargets = [];
      this.selectedTargetContext = null;
      this.targetContextControls = [];
      
      // Cargar los targets específicos del flujo actual
      // Ejemplo: cji3.json -> CJI3-targets.json
      setTimeout(() => {
        this.loadTargetsForCurrentFlow(name);
      }, 50);
    } catch (error) {
      console.error('Error al parsear JSON:', error);
      // Si hay error de parseo, también puede ser un flujo en blanco
      const isEmptyJson = jsonContent.trim() === '' || jsonContent.trim() === '{}';
      if (isEmptyJson) {
        console.log('JSON vacío detectado, mostrando selector de tcode');
        this.showTcodeSelector = true;
        this.selectedTcodeForBlankFlow = '';
        return;
      }
      
      this.flowService.importSapFlow(jsonContent, name);
      this.flowCode = jsonContent;
      // Inicializar vacío si hay error
      this.stepsData = {};
      this.targetContextData = {};
    }
  }
  
  /**
   * Carga la lista de tcodes disponibles desde los archivos de targets en SFTP
   */
  loadAvailableTcodes(): void {
    this.loadingTcodes = true;
    this.availableTcodes = [];
    
    this.sftpService.listTargets().subscribe({
      next: (response) => {
        this.loadingTcodes = false;
        if (response.status && response.files) {
          // Extraer tcodes de los nombres de archivos (ej: "CJI3-targets.json" -> "CJI3")
          const tcodes = new Set<string>();
          
          response.files
            .filter(file => !file.isDirectory && file.name.endsWith('-targets.json'))
            .forEach(file => {
              // Extraer el tcode del nombre del archivo
              // Formato esperado: "{TCODE}-targets.json"
              const match = file.name.match(/^(.+)-targets\.json$/i);
              if (match && match[1]) {
                const tcode = match[1].toUpperCase();
                tcodes.add(tcode);
              }
            });
          
          // Convertir Set a Array y ordenar alfabéticamente
          this.availableTcodes = Array.from(tcodes).sort();
          
          console.log('Tcodes disponibles cargados:', this.availableTcodes);
          
          if (this.availableTcodes.length === 0) {
            console.warn('No se encontraron archivos de targets con el formato esperado');
          }
        } else {
          console.error('Error al cargar lista de targets:', response.message);
        }
      },
      error: (error) => {
        this.loadingTcodes = false;
        console.error('Error al cargar lista de targets desde SFTP:', error);
      }
    });
  }
  
  /**
   * Confirma la selección de tcode para un flujo en blanco
   */
  confirmTcodeSelection(): void {
    if (!this.selectedTcodeForBlankFlow) {
      alert('Por favor seleccione un T-Code');
      return;
    }
    
    const tcodeUpper = this.selectedTcodeForBlankFlow.toUpperCase();
    const fileName = `${tcodeUpper.toLowerCase()}.json`;
    
    // Inicializar el flujo con el tcode seleccionado
    this.flowData = {
      $meta: {
        tcode: tcodeUpper,
        description: `Flujo para ${tcodeUpper}`
      },
      targetContext: {},
      steps: {}
    };
    
    this.stepsData = {};
    this.targetContextData = {};
    this.flowCode = JSON.stringify(this.flowData, null, 2);
    this.currentFlowFileName = fileName; // Establecer el nombre del archivo
    
    // Crear y establecer el archivo seleccionado para que pueda guardarse
    const newFile: FileInfo = {
      name: fileName,
      path: `/${tcodeUpper.toLowerCase()}.json`, // Ruta relativa
      size: new Blob([this.flowCode]).size,
      modified: new Date(),
      content: this.flowCode
    };
    
    // Establecer el archivo como seleccionado
    this.fileService.setSelectedFile(newFile);
    this.flowService.importSapFlow(this.flowCode, fileName);
    
    // Cerrar el modal
    this.showTcodeSelector = false;
    
    // Cargar los targets correspondientes al tcode seleccionado
    this.loadTargetsForTcode(tcodeUpper);
    
    // Actualizar currentTcode
    this.currentTcode = tcodeUpper;
  }
  
  /**
   * Cancela la selección de tcode
   */
  cancelTcodeSelection(): void {
    this.showTcodeSelector = false;
    this.selectedTcodeForBlankFlow = '';
  }
  
  /**
   * Carga los targets para un tcode específico
   */
  loadTargetsForTcode(tcode: string): void {
    this.loadingTargets = true;
    const targetFileName = `${tcode}-targets.json`;
    
    this.sftpService.listTargets().subscribe({
      next: (response) => {
        this.loadingTargets = false;
        if (response.status && response.files) {
          const targetFile = response.files.find(
            f => !f.isDirectory && f.name === targetFileName
          );
          
          if (targetFile) {
            console.log('Archivo de targets encontrado:', targetFile.path);
            this.sftpService.getTargetContent(targetFile.path).subscribe({
              next: (targetResponse) => {
                if (targetResponse.status && targetResponse.content) {
                  try {
                    const targetsData = JSON.parse(targetResponse.content);
                    console.log('loadTargetsForTcode - targetsData cargado con', Object.keys(targetsData.TargetControls || {}).length, 'targets');
                    // Guardar el JSON completo para previsualización
                    this.targetsJsonData = targetsData;
                    // Procesar los targets del archivo
                    this.processTargetsFromFile(targetsData, tcode, targetFile.path);
                  } catch (error) {
                    console.error('Error al parsear targets:', error);
                  }
                } else {
                  console.error('Error en respuesta de getTargetContent:', targetResponse.message);
                }
              },
              error: (error) => {
                console.error('Error al cargar contenido de targets:', error);
                this.loadingTargets = false;
              }
            });
          } else {
            console.warn(`No se encontró archivo de targets para el tcode: ${targetFileName}`);
            this.loadingTargets = false;
          }
        } else {
          console.error('Error en respuesta de listTargets:', response.message);
          this.loadingTargets = false;
        }
      },
      error: (error) => {
        this.loadingTargets = false;
        console.error('Error al buscar targets del tcode:', error);
      }
    });
  }
  
  exportFlowToJson(): string {
    // Usar flowData directamente para preservar el orden actualizado de los steps
    if (this.flowData) {
      return JSON.stringify(this.flowData, null, 2);
    }
    
    // Fallback al servicio si no hay flowData
    const sapFlow = this.flowService.exportToSapFlow();
    if (sapFlow) {
      return JSON.stringify(sapFlow, null, 2);
    }
    return '';
  }
  
  saveChanges(): void {
    // ===== ASEGURAR QUE TODOS LOS CONTENEDORES TENGAN ENTRADAS EN STEPS =====
    // Asegurar que cada contenedor tenga una entrada en steps, incluso si está vacía
    if (!this.stepsData) {
      this.stepsData = {};
    }
    
    // Iterar sobre todos los contenedores y asegurar que tengan entrada en steps
    this.targetContainers.forEach(container => {
      const key = container.fullKey;
      if (!this.stepsData[key]) {
        this.stepsData[key] = {};
      }
    });
    
    // Asegurarse de que flowData esté actualizado con todos los cambios
    if (!this.flowData) {
      this.flowData = {
        $meta: this.flowData?.$meta || {},
        targetContext: this.targetContextData || {},
        steps: {}
      };
    }
    if (!this.flowData.steps) {
      this.flowData.steps = {};
    }
    
    // Sincronizar flowData.steps con stepsData, asegurando que todos los contenedores tengan entrada
    // IMPORTANTE: Hacer una copia profunda para evitar problemas de referencia
    this.targetContainers.forEach(container => {
      const key = container.fullKey;
      if (this.stepsData[key]) {
        // Hacer una copia profunda del objeto para evitar problemas de referencia
        this.flowData.steps[key] = JSON.parse(JSON.stringify(this.stepsData[key]));
      } else {
        // Crear entrada vacía si no existe
        this.flowData.steps[key] = {};
      }
    });
    
    // También sincronizar TODAS las claves de stepsData, no solo las de los contenedores visibles
    // Esto asegura que no se pierdan datos si hay alguna inconsistencia
    Object.keys(this.stepsData).forEach(key => {
      if (this.stepsData[key] && Object.keys(this.stepsData[key]).length > 0) {
        this.flowData.steps[key] = JSON.parse(JSON.stringify(this.stepsData[key]));
      }
    });
    // ===== FIN ASEGURAR ENTRADAS =====
    
    // Actualizar flowData con los datos actuales
    this.flowData.targetContext = this.targetContextData || {};
    
    // Debug: Verificar que flowData.steps tenga todos los datos antes de guardar
    console.log('=== ANTES DE GUARDAR ===');
    console.log('targetContainers:', this.targetContainers.map(c => ({ fullKey: c.fullKey, controlsCount: c.controls.length })));
    console.log('stepsData keys:', Object.keys(this.stepsData));
    console.log('flowData.steps keys:', Object.keys(this.flowData.steps));
    this.targetContainers.forEach(container => {
      const key = container.fullKey;
      console.log(`stepsData[${key}]:`, this.stepsData[key]);
      console.log(`flowData.steps[${key}]:`, this.flowData.steps[key]);
    });
    console.log('========================');
    
    // Actualizar todos los campos next antes de exportar
    this.targetContainers.forEach(container => {
      this.updateNextFields(container);
    });
    
    // ===== SINCRONIZACIÓN FINAL ANTES DE EXPORTAR =====
    // Asegurar que flowData.steps tenga TODOS los datos de stepsData antes de exportar
    // Esto es crítico para evitar que se pierdan datos
    Object.keys(this.stepsData).forEach(key => {
      if (this.stepsData[key]) {
        // Hacer copia profunda para evitar problemas de referencia
        this.flowData.steps[key] = JSON.parse(JSON.stringify(this.stepsData[key]));
      }
    });
    // También asegurar que flowData.targetContext tenga todos los datos
    this.flowData.targetContext = JSON.parse(JSON.stringify(this.targetContextData || {}));
    // ===== FIN SINCRONIZACIÓN FINAL =====
    
    // Debug: Verificar flowData antes de exportar
    console.log('=== ANTES DE EXPORTAR ===');
    console.log('flowData.steps tiene KSCLI::2?:', !!this.flowData.steps?.['KSCLI::2']);
    if (this.flowData.steps?.['KSCLI::2']) {
      console.log('flowData.steps[KSCLI::2]:', this.flowData.steps['KSCLI::2']);
    }
    
    const jsonContent = this.exportFlowToJson();
    if (!jsonContent) {
      this.showSaveMessage('Error: No se pudo exportar el contenido JSON', 'error');
      return;
    }
    
    // Actualizar preview del JSON
    this.jsonPreview = jsonContent;

    // Debug: Verificar que el JSON exportado tenga el control
    try {
      const parsedJson = JSON.parse(jsonContent);
      console.log('=== JSON EXPORTADO ===');
      console.log('JSON tiene KSCLI::2?:', !!parsedJson.steps?.['KSCLI::2']);
      if (parsedJson.steps?.['KSCLI::2']) {
        console.log('JSON steps[KSCLI::2]:', parsedJson.steps['KSCLI::2']);
      }
    } catch (e) {
      // Continuar con validación normal
    }

    // Validar que el JSON es válido
    try {
      JSON.parse(jsonContent);
    } catch (error) {
      this.showSaveMessage('Error: El contenido JSON generado no es válido', 'error');
      console.error('Error al parsear JSON:', error);
      return;
    }
    
    // ===== VALIDACIÓN COMPLETA DEL FLUJO =====
    this.jsonBeforeSave = jsonContent;
    this.validationResult = this.flowValidator.validateJsonBeforeSave(jsonContent);
    
    // Agregar log de validación
    this.addDebugLog('info', 'Validación del flujo completada', {
      isValid: this.validationResult.isValid,
      errors: this.validationResult.errors.length,
      warnings: this.validationResult.warnings.length
    });
    
    // Si hay errores críticos, mostrar y no guardar
    if (this.validationResult.errors.length > 0) {
      const errorMessages = this.validationResult.errors.map(e => e.message).join('\n');
      this.showSaveMessage(`Error: El flujo tiene ${this.validationResult.errors.length} error(es) que deben corregirse antes de guardar:\n${errorMessages}`, 'error');
      
      // Actualizar errores de contenedores para mostrar visualmente
      this.updateContainerErrors();
      
      this.isSaving = false;
      this.isUpdatingFile = false;
      return;
    }
    
    // Si hay warnings, mostrar pero permitir guardar
    if (this.validationResult.warnings.length > 0) {
      const warningMessages = this.validationResult.warnings.slice(0, 3).map(w => w.message).join('\n');
      const moreWarnings = this.validationResult.warnings.length > 3 ? `\n... y ${this.validationResult.warnings.length - 3} advertencia(s) más` : '';
      this.showSaveMessage(`Advertencia: El flujo tiene ${this.validationResult.warnings.length} advertencia(s):\n${warningMessages}${moreWarnings}`, 'info');
    }
    
    // Actualizar errores de contenedores
    this.updateContainerErrors();
    // ===== FIN VALIDACIÓN =====

    // Mostrar indicador de carga
    this.isSaving = true;
    this.isUpdatingFile = true;
    
    this.fileService.getSelectedFile().subscribe({
      next: (file) => {
        // Si no hay archivo seleccionado pero hay un nombre de flujo actual, crear uno nuevo
        if (!file) {
          if (this.currentFlowFileName) {
            // Crear un nuevo archivo basado en el nombre del flujo actual
            const newFile: FileInfo = {
              name: this.currentFlowFileName,
              path: `/${this.currentFlowFileName}`, // Ruta relativa
              size: new Blob([jsonContent]).size,
              modified: new Date(),
              content: jsonContent
            };
            
            // Establecer el archivo como seleccionado
            this.fileService.setSelectedFile(newFile);
            
            // Usar el nuevo archivo para guardar
            file = newFile;
          } else {
            this.isSaving = false;
            this.isUpdatingFile = false;
            this.showSaveMessage('Error: No hay archivo seleccionado para guardar. Por favor, seleccione un flujo o cree uno nuevo.', 'error');
            return;
          }
        }

        const updatedFile = {
          ...file,
          content: jsonContent,
          size: new Blob([jsonContent]).size,
          modified: new Date(),
          // Asegurar que el path esté presente (requerido por el backend)
          path: file.path || `/${file.name}`
        };

        // Debug: Mostrar datos que se envían
        console.log('Datos enviados al backend:', {
          name: updatedFile.name,
          path: updatedFile.path,
          size: updatedFile.size,
          contentPreview: jsonContent.substring(0, 200) + '...'
        });

        this.fileService.updateFile(updatedFile).subscribe({
          next: (result) => {
            this.isSaving = false;
            console.log('Archivo actualizado correctamente:', result.name);
            
            // Mostrar mensaje de éxito
            this.showSaveMessage('Archivo guardado exitosamente', 'success');
            
            // Actualizar el código del flujo mostrado
            this.flowCode = jsonContent;
            
            // Restaurar la bandera después de un breve delay para permitir que se complete la actualización
            setTimeout(() => {
              this.isUpdatingFile = false;
            }, 100);
          },
          error: (error) => {
            this.isSaving = false;
            this.isUpdatingFile = false;
            console.error('Error al actualizar archivo:', error);
            
            // Mostrar mensaje de error más informativo
            let errorMessage = 'Error al guardar el archivo';
            if (error.error && error.error.error) {
              errorMessage = `Error: ${error.error.error}`;
            } else if (error.message) {
              errorMessage = `Error: ${error.message}`;
            }
            
            this.showSaveMessage(errorMessage, 'error');
          }
        });
      },
      error: (error) => {
        this.isSaving = false;
        this.isUpdatingFile = false;
        console.error('Error al obtener archivo seleccionado:', error);
        this.showSaveMessage('Error al obtener el archivo seleccionado', 'error');
      }
    });
  }

  // Método para mostrar mensajes de guardado
  showSaveMessage(message: string, type: 'success' | 'error' | 'info'): void {
    this.saveMessage = message;
    this.saveMessageType = type;
    
    // Limpiar el mensaje después de 3 segundos
    setTimeout(() => {
      this.saveMessage = '';
    }, 3000);
  }

  /**
   * Obtiene el placeholder para el editor de JSON completo
   */
  getJsonEditorPlaceholder(): string {
    return 'Edita el JSON aquí...\n\nTipos de datos comunes:\n- Fechas: YYYY-MM-DD\n- Números: valores numéricos\n- Códigos: texto alfanumérico\n- Booleanos: true/false\n- Timeouts: 5s, 10s, etc.\n- Operadores: ==, !=, >, <, exists';
  }

  /**
   * Determina el tipo de dato y placeholder para un parámetro basándose en su nombre
   */
  getParamTypeHint(paramName: string): string {
    if (!paramName) return 'Ingrese valor';
    
    const paramLower = paramName.toLowerCase().trim();
    
    // Placeholders específicos para campos de fecha
    if (paramLower.includes('date') && paramLower.includes('low')) {
      return 'Fecha Inicio (YYYY-MM-DD)';
    }
    if (paramLower.includes('date') && paramLower.includes('high')) {
      return 'Fecha Fin (YYYY-MM-DD)';
    }
    if (paramLower.includes('date') || paramLower.includes('fecha')) {
      return 'Fecha (YYYY-MM-DD)';
    }
    
    // Placeholders para campos numéricos
    if (paramLower.includes('amount') || paramLower.includes('monto') || paramLower.includes('cantidad') || paramLower.includes('quantity')) {
      return 'Número (ej: 1000)';
    }
    if (paramLower.includes('number') || paramLower.includes('numero') || paramLower.includes('num')) {
      return 'Número';
    }
    if (paramLower.includes('count') || paramLower.includes('contador')) {
      return 'Número entero';
    }
    if (paramLower.includes('max') || paramLower.includes('min') || paramLower.includes('maximum') || paramLower.includes('minimum')) {
      return 'Número';
    }
    
    // Placeholders para códigos y IDs
    if (paramLower.includes('code') || paramLower.includes('codigo') || paramLower.includes('id')) {
      return 'Código (texto)';
    }
    if (paramLower.includes('centro') || paramLower.includes('center') || paramLower.includes('werks')) {
      return 'Centro (código)';
    }
    if (paramLower.includes('almacen') || paramLower.includes('warehouse') || paramLower.includes('lgort')) {
      return 'Almacén (código)';
    }
    if (paramLower.includes('material') || paramLower.includes('matnr')) {
      return 'Material (código)';
    }
    if (paramLower.includes('order') || paramLower.includes('orden') || paramLower.includes('aufnr')) {
      return 'Orden (código)';
    }
    if (paramLower.includes('cost') || paramLower.includes('costo') || paramLower.includes('kstar')) {
      return 'Elemento de Costo (código)';
    }
    if (paramLower.includes('group') || paramLower.includes('grupo') || paramLower.includes('grp')) {
      return 'Grupo (código)';
    }
    
    // Placeholders para campos booleanos
    if (paramLower.includes('has') || paramLower.includes('is') || paramLower.includes('nosum') || paramLower.includes('nosum')) {
      return 'Booleano (true/false)';
    }
    
    // Placeholders para campos de texto
    if (paramLower.includes('name') || paramLower.includes('nombre') || paramLower.includes('desc') || paramLower.includes('description')) {
      return 'Texto';
    }
    if (paramLower.includes('layout') || paramLower.includes('variante') || paramLower.includes('variant')) {
      return 'Nombre de Layout/Variante';
    }
    if (paramLower.includes('type') || paramLower.includes('tipo')) {
      return 'Tipo (texto)';
    }
    if (paramLower.includes('category') || paramLower.includes('categoria')) {
      return 'Categoría (texto)';
    }
    if (paramLower.includes('class') || paramLower.includes('clase')) {
      return 'Clase (texto)';
    }
    
    // Placeholders para timeouts
    if (paramLower.includes('timeout') || paramLower.includes('tiempo')) {
      return 'Tiempo (ej: 5s, 10s)';
    }
    
    // Placeholders para operadores
    if (paramLower.includes('operator') || paramLower.includes('operador')) {
      return 'Operador (==, !=, >, <, exists)';
    }
    
    // Placeholders para valores por defecto
    if (paramLower.includes('default') || paramLower.includes('valor') || paramLower.includes('value')) {
      return 'Valor por defecto';
    }
    
    // Placeholder genérico
    return 'Ingrese valor';
  }
  
  cancelEditing(): void {
    // Restaurar el contenido original si existe
    if (this.originalFlowCode) {
      this.flowCode = this.originalFlowCode;
    }
    this.isEditing = false;
  }
  
  getBootstrapIcon(type: string): string {
    switch (type) {
      case 'action': return 'bi-play-circle';
      case 'decision': return 'bi-diamond';
      default: return 'bi-question-circle';
    }
  }
  
  // Métodos para modo pantalla completa
  toggleFullscreen(): void {
    if (this.isFullscreen) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen();
    }
  }
  
  enterFullscreen(): void {
    this.isFullscreen = true;
    this.canvasHeight = 'calc(100vh - 48px)';
    
    // No usar el API de Fullscreen nativo, ya que causa problemas
    // Solo usar nuestro propio modo de pantalla completa mediante CSS
    document.body.classList.add('editor-fullscreen');
    
    // Centrar el canvas después de entrar en pantalla completa
    setTimeout(() => {
      this.centerCanvas();
    }, 300);
  }
  
  exitFullscreen(): void {
    this.isFullscreen = false;
    this.canvasHeight = '600px';
    
    // Si estamos en fullscreen nativo del navegador, salir de él
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(err => {
        console.error('Error al salir de pantalla completa:', err);
      });
    }
    
    // Eliminar clase para estilo de pantalla completa
    document.body.classList.remove('editor-fullscreen');
    
    // Centrar el canvas después de salir de pantalla completa
    setTimeout(() => {
      this.centerCanvas();
    }, 300);
  }
  
  // Escuchar evento de cambio de pantalla completa del navegador
  @HostListener('document:fullscreenchange')
  @HostListener('document:webkitfullscreenchange')
  @HostListener('document:mozfullscreenchange')
  @HostListener('document:MSFullscreenChange')
  onFullscreenChange(): void {
    // Verificar si el documento está en modo pantalla completa
    const doc = document as any;
    const isInFullscreen = document.fullscreenElement;
    
    // Si salimos del fullscreen nativo, asegurarnos de actualizar nuestro estado
    if (!isInFullscreen && this.isFullscreen) {
      this.isFullscreen = false;
      this.canvasHeight = '600px';
      document.body.classList.remove('editor-fullscreen');
    }
  }
  
  // Métodos para configuración de visualización
  toggleDarkMode(): void {
    this.isDarkMode = !this.isDarkMode;
    const canvas = document.querySelector('.flow-canvas') as HTMLElement;
    if (canvas) {
      if (this.isDarkMode) {
        canvas.classList.add('dark-mode');
        canvas.classList.remove('light-mode');
      } else {
        canvas.classList.add('light-mode');
        canvas.classList.remove('dark-mode');
      }
    }
  }
  
  toggleMinimap(): void {
    this.showMinimap = !this.showMinimap;
    // Implementar lógica para mostrar/ocultar minimapa
  }
  
  toggleNodeLabels(): void {
    this.showNodeLabels = !this.showNodeLabels;
    const nodeLabels = document.querySelectorAll('.node-label');
    nodeLabels.forEach(label => {
      (label as HTMLElement).style.display = this.showNodeLabels ? 'block' : 'none';
    });
  }

  // Método para habilitar/deshabilitar layout automático
  toggleAutoLayout(): void {
    this.autoLayoutEnabled = !this.autoLayoutEnabled;
    
    if (this.autoLayoutEnabled && this.flowNodes.length > 0) {
      // Aplicar layout si se habilita
      this.createUltraSpacedLayout();
    }
  }

  // Método simplificado para organizar nodos sin detectar containers
  applySimpleLayout(): void {
    if (this.flowNodes.length === 0) return;
    
    const spacing = 150;
    const startX = 100;
    const startY = 100;
    
    // Organizar todos los nodos en una sola columna simple
    this.flowNodes.forEach((node, index) => {
      node.x = startX;
      node.y = startY + (index * spacing);
      // No llamar updateNode para evitar problemas de rendimiento
      // this.flowService.updateNode(node);
    });
    
    // Centrar la vista
    this.centerCanvas();
  }

  // Método muy básico para organizar nodos sin llamar servicios
  applyBasicLayout(): void {
    if (this.flowNodes.length === 0) return;
    
    const spacing = 150;
    const startX = 100;
    const startY = 100;
    
    // Organizar todos los nodos en una sola columna simple
    this.flowNodes.forEach((node, index) => {
      node.x = startX;
      node.y = startY + (index * spacing);
    });
    
    // No centrar la vista para evitar problemas de rendimiento
    // this.centerCanvas();
  }

  // Método simplificado para centrar sin detectar containers
  centerCanvasSimple(): void {
    if (this.flowNodes.length === 0) return;
    
    // Usar valores fijos para evitar llamadas a isContainerNode
    const nodeWidth = 300;
    const nodeHeight = 150;
    
    // Calcular el centro de todos los nodos
    let minX = Number.MAX_VALUE;
    let minY = Number.MAX_VALUE;
    let maxX = Number.MIN_VALUE;
    let maxY = Number.MIN_VALUE;
    
    this.flowNodes.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + nodeWidth);
      maxY = Math.max(maxY, node.y + nodeHeight);
    });
    
    // Calcular el centro del área de nodos
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    // Obtener el tamaño del canvas
    const canvasElement = this.elementRef.nativeElement.querySelector('.flow-canvas');
    if (canvasElement) {
      const canvasRect = canvasElement.getBoundingClientRect();
      const canvasCenterX = canvasRect.width / 2;
      const canvasCenterY = canvasRect.height / 2;
      
      // Calcular el offset necesario para centrar
      this.panOffsetX = canvasCenterX - centerX;
      this.panOffsetY = canvasCenterY - centerY;
      
      // Aplicar restricciones
      this.constrainPanOffset();
    }
  }

  // Método para aplicar ultra espaciado completo manualmente
  applyUltraSpacedLayoutManually(): void {
    if (this.flowNodes.length === 0) return;
    
    // Mostrar indicador de carga
    console.log('Aplicando ultra espaciado...');
    
    // Usar setTimeout para no bloquear la UI
    setTimeout(() => {
      this.createUltraSpacedLayout();
      console.log('Ultra espaciado aplicado');
    }, 100);
  }

  // Método de emergencia - solo posicionar nodos sin hacer nada más
  positionNodesOnly(): void {
    if (this.flowNodes.length === 0) return;
    
    const spacing = 150;
    const startX = 100;
    const startY = 100;
    
    // Solo cambiar posiciones, nada más
    this.flowNodes.forEach((node, index) => {
      node.x = startX;
      node.y = startY + (index * spacing);
    });
  }
  
  // Métodos para zoom y desplazamiento
  zoomIn(): void {
    if (this.zoomLevel < 2) {
      this.zoomLevel += 0.1;
    }
  }
  
  zoomOut(): void {
    if (this.zoomLevel > 0.5) {
      this.zoomLevel -= 0.1;
    }
  }
  
  resetZoom(): void {
    this.zoomLevel = 1;
    this.panOffsetX = 0;
    this.panOffsetY = 0;
  }
  
  // Manejar el zoom con la rueda del mouse
  @HostListener('wheel', ['$event'])
  onMouseWheel(event: WheelEvent): void {
    if (event.ctrlKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.05 : 0.05;
      const newZoom = Math.max(0.5, Math.min(2, this.zoomLevel + delta));
      
      // Ajustar el zoom alrededor del punto donde está el cursor
      if (newZoom !== this.zoomLevel) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        // Calcular el nuevo offset para mantener el punto bajo el cursor
        this.panOffsetX = mouseX - (mouseX - this.panOffsetX) * (newZoom / this.zoomLevel);
        this.panOffsetY = mouseY - (mouseY - this.panOffsetY) * (newZoom / this.zoomLevel);
        
        this.zoomLevel = newZoom;
      }
    }
  }
  
  // Iniciar el desplazamiento (pan) con el botón central o espacio + arrastrar
  startPanning(event: MouseEvent): void {
    if (event.button === 1 || (event.button === 0 && event.ctrlKey)) {
      event.preventDefault();
      this.isPanning = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    }
  }
  
  // Mover el canvas mientras se desplaza
  doPanning(event: MouseEvent): void {
    if (this.isPanning) {
      const deltaX = event.clientX - this.lastMouseX;
      const deltaY = event.clientY - this.lastMouseY;
      
      this.panOffsetX += deltaX;
      this.panOffsetY += deltaY;
      
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    }
  }
  
  // Detener el desplazamiento
  stopPanning(): void {
    this.isPanning = false;
  }
  
  // Organización automática de nodos
  autoArrangeNodes(): void {
    if (this.flowNodes.length === 0) return;
    
    // Usar layout simple para evitar problemas de rendimiento
    this.applySimpleLayout();
    return;
    
    // Encontrar el nodo inicial (normalmente el que no tiene conexiones entrantes)
    const startNode = this.flowNodes.find(node => 
      !this.connections.some(conn => conn.targetId === node.id)
    ) || this.flowNodes[0];
    
    // Restablecer posiciones
    this.flowNodes.forEach(node => {
      node.x = 0;
      node.y = 0;
    });
    
    // Organizar los nodos en niveles
    const visited = new Set<string>();
    const levels: { [level: number]: string[] } = {};
    
    // Función para recorrer el grafo y asignar niveles
    const assignLevels = (nodeId: string, level: number) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      
      if (!levels[level]) levels[level] = [];
      levels[level].push(nodeId);
      
      // Encontrar nodos conectados
      const outgoingConnections = this.connections.filter(conn => conn.sourceId === nodeId);
      outgoingConnections.forEach(conn => {
        assignLevels(conn.targetId, level + 1);
      });
    };
    
    // Comenzar la asignación de niveles desde el nodo inicial
    assignLevels(startNode.id, 0);
    
    // Posicionar los nodos según su nivel con espaciado optimizado
    const baseNodeWidth = 280;  
    const baseNodeHeight = 140; 
    const containerNodeWidth = 350;  // Ancho más amplio para containers
    const containerNodeHeight = 180; // Altura más amplia para containers
    const baseHorizontalSpacing = this.horizontalSpacing;
    const baseVerticalSpacing = this.verticalSpacing;
    const initialOffset = 200;     // Margen inicial más amplio
    
    // Calcular el espaciado máximo necesario para cada nivel
    let maxLevelWidth = 0;
    let currentY = initialOffset;
    
    Object.keys(levels).forEach(levelStr => {
      const level = parseInt(levelStr);
      const nodesInLevel = levels[level];
      
      // Separar containers de nodos regulares
      const containerNodes: string[] = [];
      const regularNodes: string[] = [];
      
      nodesInLevel.forEach(nodeId => {
        const node = this.flowNodes.find(n => n.id === nodeId);
        if (node && this.isContainerNode(node)) {
          containerNodes.push(nodeId);
        } else {
          regularNodes.push(nodeId);
        }
      });
      
      // Calcular X position para este nivel
      const levelWidth = containerNodes.length > 0 ? containerNodeWidth : baseNodeWidth;
      const levelHorizontalSpacing = containerNodes.length > 0 ? 
        baseHorizontalSpacing * this.containerSpacingMultiplier : baseHorizontalSpacing;
      const levelX = initialOffset + level * (levelWidth + levelHorizontalSpacing);
      
      // Posicionar primero los nodos regulares
      let nodeY = currentY;
      regularNodes.forEach((nodeId, index) => {
        const node = this.flowNodes.find(n => n.id === nodeId);
        if (node) {
          node.x = levelX;
          node.y = nodeY;
          nodeY += baseNodeHeight + baseVerticalSpacing;
          this.flowService.updateNode(node);
        }
      });
      
      // Posicionar los containers con más espacio
      if (containerNodes.length > 0) {
        // Agregar espacio extra antes de los containers si hay nodos regulares
        if (regularNodes.length > 0) {
          nodeY += baseVerticalSpacing;
        }
        
        containerNodes.forEach((nodeId, index) => {
          const node = this.flowNodes.find(n => n.id === nodeId);
          if (node) {
            node.x = levelX;
            node.y = nodeY;
            nodeY += containerNodeHeight + (baseVerticalSpacing * this.containerSpacingMultiplier);
            this.flowService.updateNode(node);
          }
        });
      }
      
      // Actualizar la posición Y para el próximo nivel
      if (level === 0) {
        currentY = Math.max(currentY, nodeY + baseVerticalSpacing);
      }
    });
    
    // Centrar el canvas en los nodos
    this.centerCanvas();
  }
  
  // Centrar el canvas en los nodos
  centerCanvas(): void {
    if (this.flowNodes.length === 0) return;
    
    // Calcular el centro de todos los nodos
    let minX = Number.MAX_VALUE;
    let minY = Number.MAX_VALUE;
    let maxX = Number.MIN_VALUE;
    let maxY = Number.MIN_VALUE;
    
    this.flowNodes.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      
      // Usar el tamaño específico según el tipo de nodo
      const nodeWidth = this.isContainerNode(node) ? 350 : 280;
      const nodeHeight = this.isContainerNode(node) ? 180 : 140;
      
      maxX = Math.max(maxX, node.x + nodeWidth);
      maxY = Math.max(maxY, node.y + nodeHeight);
    });
    
    // Obtener dimensiones reales del canvas
    const canvasElement = this.elementRef.nativeElement.querySelector('.flow-canvas');
    const canvasWidth = canvasElement ? canvasElement.offsetWidth : 1000;
    const canvasHeight = canvasElement ? canvasElement.offsetHeight : 600;
    
    // Calcular offsets para centrar con margen
    const margin = 50;
    this.panOffsetX = Math.max(margin, (canvasWidth - (maxX - minX)) / 2 - minX);
    this.panOffsetY = Math.max(margin, (canvasHeight - (maxY - minY)) / 2 - minY);
  }
  
  // Ajustar la posición de un nodo a la cuadrícula
  snapToGrid(value: number): number {
    return Math.round(value / this.gridSize) * this.gridSize;
  }
  
  // Cambiar el espaciado entre nodos
  changeNodeSpacing(spacingOption: any): void {
    this.horizontalSpacing = spacingOption.horizontal;
    this.verticalSpacing = spacingOption.vertical;
    
    // Reorganizar automáticamente si hay nodos
    if (this.flowNodes.length > 0) {
      this.autoArrangeNodes();
    }
  }
  
  // Obtener el espaciado actual
  getCurrentSpacingLabel(): string {
    const current = this.nodeSpacingOptions.find(option => 
      option.horizontal === this.horizontalSpacing && 
      option.vertical === this.verticalSpacing
    );
    return current ? current.label : 'Personalizado';
  }
  
  // Cambiar el espaciado específico para containers
  changeContainerSpacing(spacingOption: any): void {
    this.containerSpacingMultiplier = spacingOption.multiplier;
    
    // Reorganizar automáticamente si hay nodos
    if (this.flowNodes.length > 0) {
      this.autoArrangeNodes();
    }
  }
  
  // Obtener el espaciado actual de containers
  getCurrentContainerSpacingLabel(): string {
    const current = this.containerSpacingOptions.find(option => 
      option.multiplier === this.containerSpacingMultiplier
    );
    return current ? current.label : 'Personalizado';
  }
  
  // Optimizar el layout específicamente para containers
  optimizeContainerLayout(): void {
    if (this.flowNodes.length === 0) return;
    
    // Algoritmo especializado para containers
    const containerNodes = this.flowNodes.filter(node => this.isContainerNode(node));
    const regularNodes = this.flowNodes.filter(node => !this.isContainerNode(node));
    
    const containerWidth = 350;
    const containerHeight = 180;
    const regularWidth = 280;
    const regularHeight = 140;
    
    const containerHSpacing = this.horizontalSpacing * 3.5;
    const containerVSpacing = this.verticalSpacing * 3.5;
    const regularHSpacing = this.horizontalSpacing;
    const regularVSpacing = this.verticalSpacing;
    
    const startX = 250;
    const startY = 250;
    
    // Organizar containers en una cuadrícula más espaciada
    let containerX = startX;
    let containerY = startY;
    let containersPerRow = Math.max(1, Math.floor(containerNodes.length / 3));
    
    containerNodes.forEach((node, index) => {
      node.x = containerX;
      node.y = containerY;
      
      // Mover a la siguiente posición
      if ((index + 1) % containersPerRow === 0) {
        containerX = startX;
        containerY += containerHeight + containerVSpacing;
      } else {
        containerX += containerWidth + containerHSpacing;
      }
      
      this.flowService.updateNode(node);
    });
    
    // Organizar nodos regulares en una columna separada
    let regularX = startX + (containerWidth + containerHSpacing) * containersPerRow + containerHSpacing;
    let regularY = startY;
    
    regularNodes.forEach((node, index) => {
      node.x = regularX;
      node.y = regularY;
      regularY += regularHeight + regularVSpacing;
      
      this.flowService.updateNode(node);
    });
    
    // Centrar la vista
    this.centerCanvas();
  }
  
  // Crear un layout ultra espaciado para máxima comodidad
  createUltraSpacedLayout(): void {
    if (this.flowNodes.length === 0) return;
    
    // Limpiar caché antes de procesar
    this.containerNodeCache.clear();
    
    // Separar containers y nodos regulares de forma más eficiente
    const containerNodes: FlowNode[] = [];
    const regularNodes: FlowNode[] = [];
    
    // Clasificar nodos en una sola pasada
    this.flowNodes.forEach(node => {
      if (this.isContainerNode(node)) {
        containerNodes.push(node);
      } else {
        regularNodes.push(node);
      }
    });
    
    const containerWidth = 350;
    const containerHeight = 180;
    const regularWidth = 280;
    const regularHeight = 140;
    
    // Espaciado optimizado
    const ultraHSpacing = 150;
    const ultraVSpacing = 120;
    
    const startX = 100;
    const startY = 100;
    
    // Organizar containers en una columna
    let containerY = startY;
    containerNodes.forEach((node) => {
      node.x = startX;
      node.y = containerY;
      containerY += containerHeight + ultraVSpacing;
      this.flowService.updateNode(node);
    });
    
    // Organizar nodos regulares en una columna paralela
    let regularX = startX + containerWidth + ultraHSpacing;
    let regularY = startY;
    regularNodes.forEach((node) => {
      node.x = regularX;
      node.y = regularY;
      regularY += regularHeight + ultraVSpacing * 0.4;
      this.flowService.updateNode(node);
    });
    
    // Centrar la vista
    this.centerCanvas();
  }
  
  // Crear conexiones entre containers cuando el último paso de uno conecta con el primer paso del siguiente
  createContainerConnections(containerNodes: FlowNode[]): void {
    if (containerNodes.length < 2) return;
    
    // Crear un Set con IDs de containers para búsqueda rápida
    const containerIds = new Set(containerNodes.map(n => n.id));
    
    // Limpiar conexiones existentes entre containers de forma más eficiente
    this.connections = this.connections.filter(conn => {
      // Solo filtrar si ambos nodos son containers
      return !(containerIds.has(conn.sourceId) && containerIds.has(conn.targetId));
    });
    
    // Crear conexiones secuenciales entre containers
    for (let i = 0; i < containerNodes.length - 1; i++) {
      const currentContainer = containerNodes[i];
      const nextContainer = containerNodes[i + 1];
      
      // Verificar si el último paso del container actual debe conectar con el primer paso del siguiente
      if (this.shouldConnectContainers(currentContainer, nextContainer)) {
        const connection: Connection = {
          id: `container-conn-${currentContainer.id}-${nextContainer.id}`,
          sourceId: currentContainer.id,
          targetId: nextContainer.id,
          label: 'Flujo continuo'
        };
        
        this.connections.push(connection);
      }
    }
    
    // Actualizar las conexiones en el flujo actual
    this.flowService.getCurrentFlow().subscribe(currentFlow => {
      if (currentFlow) {
        currentFlow.connections = [...this.connections];
        this.flowService.loadFlow(currentFlow);
      }
    });
  }
  
  // Determinar si dos containers deben conectarse
  shouldConnectContainers(currentContainer: FlowNode, nextContainer: FlowNode): boolean {
    // Verificar que ambos nodos existan y tengan data
    if (!currentContainer || !nextContainer) return false;
    
    // Simplificar la lógica para mejorar el rendimiento
    // Solo conectar containers secuenciales por defecto
    return true;
  }
  
  onDragStart(event: DragEvent, item: any): void {
    if (event.dataTransfer) {
      event.dataTransfer.setData('type', item.type);
      this.isDragging = true;
    }
  }
  
  /**
   * Maneja el inicio del drag de un control dentro de un contenedor
   */
  onControlDragStart(event: DragEvent, control: FlowNode, container: TargetContainer): void {
    if (event.dataTransfer) {
      event.dataTransfer.setData('controlId', control.id);
      event.dataTransfer.setData('containerId', container.id);
      event.dataTransfer.setData('isContainerControl', 'true');
      event.dataTransfer.effectAllowed = 'move';
      
      this.draggedControl = control;
      this.draggedControlContainer = container;
      this.isDragging = true;
      
      // Agregar clase visual
      const controlElement = event.currentTarget as HTMLElement;
      if (controlElement) {
        controlElement.classList.add('dragging');
      }
    }
    // Detener propagación para que el contenedor no capture el evento
    event.stopPropagation();
  }
  
  onNodeDragStart(event: DragEvent, node: FlowNode): void {
    // Este método se mantiene para compatibilidad con otros nodos
    if (event.dataTransfer) {
      event.dataTransfer.setData('nodeId', node.id);
      this.isDragging = true;
    }
    event.stopPropagation();
  }
  
  /**
   * Maneja el dragover sobre un control dentro de un contenedor
   */
  onControlDragOver(event: DragEvent, control: FlowNode, container: TargetContainer, index: number): void {
    // Solo procesar si se está arrastrando un control del mismo contenedor
    if (!this.draggedControl || !this.draggedControlContainer || this.draggedControlContainer.id !== container.id) {
      return;
    }
    
    // Si se está arrastrando un contenedor, no procesar
    if (this.draggedContainer) {
      return;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    
    this.dragOverControl = control;
    this.dragOverControlIndex = index;
    
    // Agregar clase visual
    const element = event.currentTarget as HTMLElement;
    if (element) {
      element.classList.add('drag-over');
    }
  }
  
  /**
   * Maneja el dragleave de un control
   */
  onControlDragLeave(event: DragEvent): void {
    // Verificar que realmente salimos del control (no solo pasamos a un hijo)
    const relatedTarget = event.relatedTarget as HTMLElement;
    const currentTarget = event.currentTarget as HTMLElement;
    
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      // Remover clase visual solo si realmente salimos del control
      currentTarget.classList.remove('drag-over');
    }
  }
  
  /**
   * Maneja el dragenter sobre el cuerpo del contenedor
   */
  onContainerBodyDragEnter(event: DragEvent, container: TargetContainer): void {
    // Solo procesar si se está arrastrando un control del mismo contenedor
    if (this.draggedControl && this.draggedControlContainer?.id === container.id && !this.draggedContainer) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  
  /**
   * Maneja el dragleave del cuerpo del contenedor
   */
  onContainerBodyDragLeave(event: DragEvent): void {
    // Solo limpiar si realmente salimos del contenedor
    const relatedTarget = event.relatedTarget as HTMLElement;
    const currentTarget = event.currentTarget as HTMLElement;
    
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      this.dragOverControl = null;
      this.dragOverControlIndex = -1;
    }
  }
  
  /**
   * Maneja el dragover sobre el cuerpo del contenedor
   */
  onContainerBodyDragOver(event: DragEvent, container: TargetContainer): void {
    // Solo procesar si se está arrastrando un control del mismo contenedor
    if (!this.draggedControl || !this.draggedControlContainer || this.draggedControlContainer.id !== container.id) {
      return;
    }
    
    // Si se está arrastrando un contenedor, no procesar
    if (this.draggedContainer) {
      return;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    
    // Limpiar drag over control cuando se está sobre el cuerpo
    this.dragOverControl = null;
    this.dragOverControlIndex = -1;
    
    // Remover clases drag-over de todos los controles
    const containerElement = event.currentTarget as HTMLElement;
    if (containerElement) {
      containerElement.querySelectorAll('.control-node.drag-over').forEach(el => {
        el.classList.remove('drag-over');
      });
    }
  }
  
  /**
   * Maneja el drop de un control sobre otro control
   */
  onControlDrop(event: DragEvent, targetControl: FlowNode, container: TargetContainer, targetIndex: number): void {
    event.preventDefault();
    event.stopPropagation();
    
    // Verificar que se está arrastrando un control
    if (!this.draggedControl || !this.draggedControlContainer) {
      this.resetDragState();
      return;
    }
    
    // Solo procesar si ambos controles están en el mismo contenedor
    if (this.draggedControlContainer.id !== container.id) {
      this.resetDragState();
      return;
    }
    
    // Remover clases visuales
    const currentTarget = event.currentTarget as HTMLElement;
    if (currentTarget) {
      currentTarget.classList.remove('drag-over');
    }
    
    const draggedIndex = container.controls.findIndex(c => c.id === this.draggedControl!.id);
    
    if (draggedIndex === -1 || draggedIndex === targetIndex) {
      this.resetDragState();
      return;
    }
    
    console.log('Reordenando control:', draggedIndex, '->', targetIndex);
    
    // Reordenar los controles en el array
    const controls = [...container.controls];
    const [removed] = controls.splice(draggedIndex, 1);
    controls.splice(targetIndex, 0, removed);
    
    // Actualizar el array de controles del contenedor
    container.controls = controls;
    
    // Reorganizar las posiciones visuales
    this.arrangeControlsInContainer(container);
    
    // Actualizar el JSON (steps) con el nuevo orden
    this.updateStepsOrderFromContainer(container);
    
    this.resetDragState();
  }
  
  /**
   * Maneja el drop en el cuerpo del contenedor (al final de la lista)
   */
  onContainerBodyDrop(event: DragEvent, container: TargetContainer): void {
    event.preventDefault();
    event.stopPropagation();
    
    // Verificar que se está arrastrando un control
    if (!this.draggedControl || !this.draggedControlContainer) {
      this.resetDragState();
      return;
    }
    
    // Solo procesar si el control arrastrado pertenece al mismo contenedor
    if (this.draggedControlContainer.id !== container.id) {
      this.resetDragState();
      return;
    }
    
    const draggedIndex = container.controls.findIndex(c => c.id === this.draggedControl!.id);
    
    if (draggedIndex === -1) {
      this.resetDragState();
      return;
    }
    
    console.log('Moviendo control al final:', draggedIndex);
    
    // Mover al final
    const controls = [...container.controls];
    const [removed] = controls.splice(draggedIndex, 1);
    controls.push(removed);
    
    container.controls = controls;
    this.arrangeControlsInContainer(container);
    this.updateStepsOrderFromContainer(container);
    
    this.resetDragState();
  }
  
  /**
   * Actualiza el orden de los steps en el JSON basado en el orden de los controles del contenedor
   */
  updateStepsOrderFromContainer(container: TargetContainer): void {
    if (!this.stepsData || !this.flowData) {
      return;
    }
    
    // Usar fullKey para diferenciar instancias del mismo contexto
    const containerKey = container.fullKey;
    
    // Buscar los steps correspondientes a este contenedor
    if (this.stepsData[containerKey]) {
      const originalSteps = this.stepsData[containerKey];
      const orderedSteps: any = {};
      
      // Crear un nuevo objeto con los steps en el orden de los controles
      container.controls.forEach(control => {
        // Usar el label como clave del paso (que corresponde al nombre del step)
        const stepKey = control.label;
        if (originalSteps[stepKey]) {
          orderedSteps[stepKey] = originalSteps[stepKey];
        }
      });
      
      // Actualizar stepsData y flowData
      this.stepsData[containerKey] = orderedSteps;
      if (this.flowData.steps) {
        this.flowData.steps[containerKey] = orderedSteps;
      }
      
      // Actualizar los campos next después de reordenar
      this.updateNextFields(container);
      
      // Actualizar flowCode para reflejar los cambios
      this.flowCode = JSON.stringify(this.flowData, null, 2);
    }
    
    // También verificar si hay steps con instancia (ej: "KSCLO::1")
    const fullKeyWithInstance = `${containerKey}::1`;
    if (this.stepsData[fullKeyWithInstance]) {
      const originalSteps = this.stepsData[fullKeyWithInstance];
      const orderedSteps: any = {};
      
      container.controls.forEach(control => {
        const stepKey = control.label;
        if (originalSteps[stepKey]) {
          orderedSteps[stepKey] = originalSteps[stepKey];
        }
      });
      
      this.stepsData[fullKeyWithInstance] = orderedSteps;
      if (this.flowData.steps && this.flowData.steps[fullKeyWithInstance]) {
        this.flowData.steps[fullKeyWithInstance] = orderedSteps;
      }
      
      // Actualizar los campos next
      this.updateNextFields(container);
      
      this.flowCode = JSON.stringify(this.flowData, null, 2);
    }
  }
  
  /**
   * Resetea el estado del drag and drop
   */
  resetDragState(): void {
    this.draggedControl = null;
    this.draggedControlContainer = null;
    this.dragOverControl = null;
    this.dragOverControlIndex = -1;
    this.isDragging = false;
    
    // Remover clases visuales
    document.querySelectorAll('.control-node.dragging').forEach(el => {
      el.classList.remove('dragging');
    });
    document.querySelectorAll('.control-node.drag-over').forEach(el => {
      el.classList.remove('drag-over');
    });
  }
  
  onCanvasDragOver(event: DragEvent): void {
    event.preventDefault();
    
    // Si hay un control siendo arrastrado dentro de un contenedor, resetear el estado visual
    if (this.draggedControl && this.draggedControlContainer) {
      // Limpiar clases visuales cuando se sale del contenedor
      this.dragOverControl = null;
      this.dragOverControlIndex = -1;
    }
    
    // Si hay un contenedor siendo arrastrado, permitir el drop
    if (this.draggedContainer && event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }
  
  onCanvasDrop(event: DragEvent): void {
    // Si el drop fue sobre un control o contenedor, no procesar aquí
    const target = event.target as HTMLElement;
    if (target.closest('.control-node') || target.closest('.target-container-body') || target.closest('.target-container')) {
      return; // El drop será manejado por onControlDrop, onContainerBodyDrop o onContainerDrop
    }
    
    event.preventDefault();
    
    if (event.dataTransfer) {
      const isContainer = event.dataTransfer.getData('isContainer');
      const isContainerControl = event.dataTransfer.getData('isContainerControl');
      
      // Si es un contenedor siendo arrastrado, resetear el estado pero no procesar el drop aquí
      if (isContainer === 'true') {
        this.resetContainerDragState();
        return;
      }
      
      // Si es un control dentro de un contenedor, resetear el estado pero no procesar el drop
      if (isContainerControl === 'true') {
        this.resetDragState();
        return;
      }
      
      const type = event.dataTransfer.getData('type');
      const nodeId = event.dataTransfer.getData('nodeId');
      
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      
      // Ajustar las coordenadas según el zoom y el desplazamiento
      const x = (event.clientX - rect.left - this.panOffsetX) / this.zoomLevel;
      const y = (event.clientY - rect.top - this.panOffsetY) / this.zoomLevel;
      
      if (type) {
        // Crear un nuevo nodo (solo para steps)
        if (this.activeTab === 'steps') {
          this.addNode(type as 'action' | 'decision', this.snapToGrid(x), this.snapToGrid(y));
        }
      } else if (nodeId) {
        // Mover un nodo existente (steps o targetContext)
        if (this.activeTab === 'steps') {
          const node = this.flowNodes.find(n => n.id === nodeId);
          if (node) {
            node.x = this.snapToGrid(x);
            node.y = this.snapToGrid(y);
            this.flowService.updateNode(node);
          }
        } else if (this.activeTab === 'targetContext') {
          const node = this.targetContextNodes.find(n => n.id === nodeId);
          if (node) {
            node.x = this.snapToGrid(x);
            node.y = this.snapToGrid(y);
          }
        }
      }
    }
  }
  
  addNode(type: 'action' | 'decision', x: number, y: number): void {
    const newNode = this.flowService.addNode(type, x, y);
    if (newNode) {
      this.selectNode(newNode);
    }
  }
  
  selectNode(node: FlowNode): void {
    this.flowService.setSelectedNode(node);
  }
  
  // Método para abrir el editor de JSON del nodo
  openNodeJsonEditor(): void {
    if (this.selectedNode) {
      // Crear una copia del objeto data del nodo para editar
      const nodeData = {
        id: this.selectedNode.id,
        type: this.selectedNode.type,
        label: this.selectedNode.label,
        data: this.selectedNode.data || {}
      };
      
      // Convertir a JSON formateado
      this.nodeJsonContent = JSON.stringify(nodeData, null, 2);
      this.nodeJsonError = null;
      this.editingNodeId = this.selectedNode.id;
      this.showNodeEditor = true;
    }
  }
  
  // Método para cerrar el editor de JSON del nodo
  closeNodeJsonEditor(): void {
    this.showNodeEditor = false;
    this.nodeJsonContent = '';
    this.nodeJsonError = null;
    this.editingNodeId = null;
  }
  
  // Método para guardar los cambios del editor de JSON del nodo
  saveNodeJsonChanges(): void {
    if (!this.nodeJsonContent) {
      this.nodeJsonError = 'El contenido no puede estar vacío';
      return;
    }
    
    try {
      // Intentar parsear el JSON
      const nodeData = JSON.parse(this.nodeJsonContent);
      
      // Validar que el objeto tiene la estructura correcta
      if (!nodeData.id || !nodeData.type) {
        this.nodeJsonError = 'El JSON debe contener al menos las propiedades id y type';
        return;
      }
      
      // Buscar el nodo original
      const originalNode = this.flowNodes.find(n => n.id === this.editingNodeId);
      if (originalNode) {
        // Actualizar el nodo con los nuevos datos
        const updatedNode: FlowNode = {
          ...originalNode,
          label: nodeData.label || originalNode.label,
          type: nodeData.type as 'action' | 'decision',
          data: nodeData.data || {}
        };
        
        // Invalidar caché del nodo antes de actualizar
        this.invalidateNodeCache(updatedNode.id);
        
        // Actualizar el nodo en el servicio
        this.flowService.updateNode(updatedNode);
        
        // Cerrar el editor
        this.closeNodeJsonEditor();
      }
    } catch (error) {
      this.nodeJsonError = `Error de sintaxis JSON: ${error instanceof Error ? error.message : 'Error desconocido'}`;
    }
  }
  
  updateNode(): void {
    if (this.selectedNode) {
      // Abrir el editor de JSON para el nodo seleccionado
      this.openNodeJsonEditor();
    }
  }
  
  deleteNode(): void {
    if (this.selectedNode) {
      this.flowService.deleteNode(this.selectedNode.id);
    }
  }
  
  getPathForConnection(conn: Connection): string {
    const sourceNode = this.flowNodes.find(n => n.id === conn.sourceId);
    const targetNode = this.flowNodes.find(n => n.id === conn.targetId);
    
    if (!sourceNode || !targetNode) {
      return '';
    }
    
    // Calcular puntos de control para la curva Bezier
    const sourceX = sourceNode.x + 100; // Ancho del nodo = 100
    const sourceY = sourceNode.y + 30; // Altura media del nodo
    const targetX = targetNode.x;
    const targetY = targetNode.y + 30; // Altura media del nodo
    
    // Calcular puntos de control para la curva
    const dx = Math.abs(targetX - sourceX) / 2;
    
    return `M ${sourceX} ${sourceY} C ${sourceX + dx} ${sourceY}, ${targetX - dx} ${targetY}, ${targetX} ${targetY}`;
  }
  
  // Método para mostrar el JSON completo del flujo
  viewFullJson(): void {
    console.log('viewFullJson llamado');
    console.log('flowData:', this.flowData);
    console.log('targetContextData:', this.targetContextData);
    console.log('stepsData:', this.stepsData);
    
    // Guardar el contenido original antes de editar
    this.originalFlowCode = this.flowCode;
    
    // Mostrar el JSON completo del flujo (incluyendo $meta, targetContext, steps)
    if (this.flowData) {
      this.flowCode = JSON.stringify(this.flowData, null, 2);
    } else {
      // Si no hay flowData, construir desde los datos actuales
      const fullFlow = {
        $meta: this.flowData?.$meta || {},
        targetContext: this.targetContextData || {},
        steps: this.stepsData || {}
      };
      this.flowCode = JSON.stringify(fullFlow, null, 2);
    }
    
    // Guardar también como original si no había uno
    if (!this.originalFlowCode) {
      this.originalFlowCode = this.flowCode;
    }
    
    this.isEditing = true;
    console.log('isEditing establecido a:', this.isEditing);
    console.log('flowCode length:', this.flowCode?.length);
  }
  
  /**
   * Guarda el JSON editado directamente al archivo
   */
  saveEditedJson(): void {
    if (!this.flowCode || this.flowCode.trim() === '') {
      this.showSaveMessage('Error: El JSON está vacío', 'error');
      return;
    }
    
    // Validar que el JSON es válido
    let parsedJson: any;
    try {
      parsedJson = JSON.parse(this.flowCode);
    } catch (error) {
      this.showSaveMessage('Error: El JSON no es válido. Por favor, verifica la sintaxis.', 'error');
      return;
    }
    
    // Mostrar indicador de carga
    this.isSaving = true;
    this.isUpdatingFile = true;
    
    this.fileService.getSelectedFile().subscribe({
      next: (file) => {
        if (!file) {
          this.isSaving = false;
          this.isUpdatingFile = false;
          this.showSaveMessage('Error: No hay archivo seleccionado para guardar', 'error');
          return;
        }
        
        const updatedFile = {
          ...file,
          content: this.flowCode,
          size: new Blob([this.flowCode]).size,
          modified: new Date()
        };
        
        this.fileService.updateFile(updatedFile).subscribe({
          next: (result) => {
            this.isSaving = false;
            console.log('Archivo actualizado correctamente:', result.name);
            
            // Recargar el flujo con el nuevo contenido
            this.importFlowFromJson(this.flowCode, file.name);
            
            // Cerrar el modal
            this.isEditing = false;
            
            // Mostrar mensaje de éxito
            this.showSaveMessage('Archivo guardado exitosamente', 'success');
            
            // Restaurar la bandera después de un breve delay
            setTimeout(() => {
              this.isUpdatingFile = false;
            }, 100);
          },
          error: (error) => {
            this.isSaving = false;
            this.isUpdatingFile = false;
            console.error('Error al actualizar archivo:', error);
            
            let errorMessage = 'Error al guardar el archivo';
            if (error.error && error.error.error) {
              errorMessage = `Error: ${error.error.error}`;
            } else if (error.message) {
              errorMessage = `Error: ${error.message}`;
            }
            
            this.showSaveMessage(errorMessage, 'error');
          }
        });
      },
      error: (error) => {
        this.isSaving = false;
        this.isUpdatingFile = false;
        console.error('Error al obtener archivo seleccionado:', error);
        this.showSaveMessage('Error al obtener el archivo seleccionado', 'error');
      }
    });
  }

  /**
   * Exporta el targetContext a JSON
   */
  exportTargetContextToJson(): string {
    // Si no hay contenedores, retornar objeto vacío
    if (!this.targetContainers || this.targetContainers.length === 0) {
      return JSON.stringify({ targetContext: {} }, null, 2);
    }
    
    // Construir el objeto targetContext desde los contenedores y controles
    const targetContext: any = {};
    
    // Agrupar contenedores por targetContextKey (sin instancia)
    const containersByKey: { [key: string]: TargetContainer[] } = {};
    
    this.targetContainers.forEach(container => {
      const baseKey = container.targetContextKey;
      if (!containersByKey[baseKey]) {
        containersByKey[baseKey] = [];
      }
      containersByKey[baseKey].push(container);
    });
    
    // Procesar cada grupo de contenedores
    Object.keys(containersByKey).forEach(baseKey => {
      const containers = containersByKey[baseKey];
      
      // Si hay múltiples instancias, usar la sintaxis ::numeroinstancia
      if (containers.length === 1) {
        // Una sola instancia, usar la clave base
        const container = containers[0];
        const deepaliases: any = {};
        
        container.controls.forEach(control => {
          if (control.data?.target && control.data?.path) {
            deepaliases[control.data.target] = control.data.path;
          }
        });
        
        // Obtener el contexto original si existe
        const originalContext = this.targetContextData?.[baseKey];
        
        if (originalContext && typeof originalContext === 'object') {
          targetContext[baseKey] = {
            ...originalContext,
            FriendlyName: container.friendlyName,
            deepaliases: deepaliases
          };
        } else {
          targetContext[baseKey] = {
            FriendlyName: container.friendlyName,
            deepaliases: deepaliases
          };
        }
      } else {
        // Múltiples instancias, crear entradas con ::numeroinstancia
        containers.forEach(container => {
          const instanceKey = container.instanceNumber > 1 
            ? `${baseKey}::${container.instanceNumber}` 
            : baseKey;
          
          const deepaliases: any = {};
          container.controls.forEach(control => {
            if (control.data?.target && control.data?.path) {
              deepaliases[control.data.target] = control.data.path;
            }
          });
          
          // Obtener el contexto original si existe (solo para la primera instancia)
          const originalContext = container.instanceNumber === 1 
            ? this.targetContextData?.[baseKey] 
            : null;
          
          if (originalContext && typeof originalContext === 'object') {
            targetContext[instanceKey] = {
              ...originalContext,
              FriendlyName: container.friendlyName,
              deepaliases: deepaliases
            };
          } else {
            targetContext[instanceKey] = {
              FriendlyName: container.friendlyName,
              deepaliases: deepaliases
            };
          }
        });
      }
    });
    
    return JSON.stringify({ targetContext: targetContext }, null, 2);
  }
  
  // Método para activar/desactivar la cuadrícula
  toggleGrid(): void {
    this.showGrid = !this.showGrid;
  }
  
  centerOnNode(node: FlowNode): void {
    const canvas = this.elementRef.nativeElement.querySelector('.flow-canvas');
    if (!canvas) return;
    
    const canvasRect = canvas.getBoundingClientRect();
    
    // Calcular el centro del canvas
    const canvasCenterX = canvasRect.width / 2;
    const canvasCenterY = canvasRect.height / 2;
    
    // Calcular el desplazamiento necesario para centrar el nodo
    this.panOffsetX = canvasCenterX - (node.x * this.zoomLevel);
    this.panOffsetY = canvasCenterY - (node.y * this.zoomLevel);
    
    // Asegurar que el desplazamiento no se salga de los límites
    this.constrainPanOffset();
  }
  
  constrainPanOffset(): void {
    // Implementar límites de desplazamiento si es necesario
    // Por ahora, permitimos libre desplazamiento
  }
  
  // Método para controlar el acordeón
  toggleAccordion(section: string): void {
    if (this.accordionState.hasOwnProperty(section)) {
      // Usar Object.assign para crear un nuevo objeto y forzar detección de cambios
      this.accordionState = Object.assign({}, this.accordionState, {
        [section]: !this.accordionState[section]
      });
      console.log('Acordeón cambiado:', section, this.accordionState[section]);
    }
  }
  
  // Método para cargar los tipos de controles disponibles
  loadControlTypes(): void {
    this.fileService.getControlTypes().subscribe(
      controlTypes => {
        this.availableControlTypes = controlTypes;
        console.log('Tipos de controles cargados:', controlTypes);
      },
      error => {
        console.error('Error al cargar los tipos de controles:', error);
      }
    );
  }
  
  /**
   * Agrega un log al panel de debugging
   */
  addDebugLog(type: 'info' | 'warning' | 'error', message: string, data?: any): void {
    this.debugLogs.push({
      timestamp: new Date(),
      type,
      message,
      data
    });
    
    // Mantener solo los últimos 100 logs
    if (this.debugLogs.length > 100) {
      this.debugLogs.shift();
    }
  }
  
  /**
   * Actualiza los errores de contenedores basándose en la validación
   */
  updateContainerErrors(): void {
    this.containerErrors.clear();
    
    if (!this.validationResult) return;
    
    // Agrupar errores por contenedor
    [...this.validationResult.errors, ...this.validationResult.warnings].forEach(error => {
      if (error.container) {
        if (!this.containerErrors.has(error.container)) {
          this.containerErrors.set(error.container, []);
        }
        this.containerErrors.get(error.container)!.push(error.message);
      }
    });
  }
  
  /**
   * Obtiene los errores de un contenedor específico
   */
  getContainerErrors(containerKey: string): string[] {
    return this.containerErrors.get(containerKey) || [];
  }
  
  /**
   * Verifica si un contenedor tiene errores
   */
  hasContainerErrors(containerKey: string): boolean {
    return this.containerErrors.has(containerKey) && this.containerErrors.get(containerKey)!.length > 0;
  }
  
  /**
   * Obtiene el resumen de estadísticas del flujo
   */
  getFlowStatistics(): any {
    if (!this.flowData) {
      return {
        containers: 0,
        steps: 0,
        controls: 0
      };
    }
    
    const containers = Object.keys(this.targetContextData || {}).length;
    const steps = Object.keys(this.stepsData || {}).length;
    let controls = 0;
    
    if (this.stepsData) {
      Object.values(this.stepsData).forEach((containerSteps: any) => {
        if (containerSteps && typeof containerSteps === 'object') {
          controls += Object.keys(containerSteps).length;
        }
      });
    }
    
    return {
      containers,
      steps,
      controls,
      targetContainers: this.targetContainers.length,
      visualControls: this.targetContextNodes.length
    };
  }
  
  /**
   * Limpia los logs de debugging
   */
  clearDebugLogs(): void {
    this.debugLogs = [];
  }
  
  /**
   * Exporta los logs de debugging
   */
  exportDebugLogs(): void {
    const logsText = this.debugLogs.map(log => {
      return `[${log.timestamp.toISOString()}] [${log.type.toUpperCase()}] ${log.message}${log.data ? '\n' + JSON.stringify(log.data, null, 2) : ''}`;
    }).join('\n\n');
    
    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `debug-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
  
  /**
   * Compara el JSON antes y después de guardar
   */
  compareJsonBeforeAfter(): string {
    if (!this.jsonBeforeSave || !this.jsonAfterSave) {
      return 'No hay datos para comparar';
    }
    
    try {
      const before = JSON.parse(this.jsonBeforeSave);
      const after = JSON.parse(this.jsonAfterSave);
      
      const differences: string[] = [];
      
      // Comparar estructura básica
      if (JSON.stringify(before) === JSON.stringify(after)) {
        return 'No hay diferencias entre el JSON antes y después de guardar';
      }
      
      // Comparar $meta
      if (JSON.stringify(before.$meta) !== JSON.stringify(after.$meta)) {
        differences.push('$meta ha cambiado');
      }
      
      // Comparar targetContext
      const beforeKeys = Object.keys(before.targetContext || {});
      const afterKeys = Object.keys(after.targetContext || {});
      if (JSON.stringify(beforeKeys.sort()) !== JSON.stringify(afterKeys.sort())) {
        differences.push(`targetContext: ${beforeKeys.length} → ${afterKeys.length} contenedores`);
      }
      
      // Comparar steps
      const beforeStepsKeys = Object.keys(before.steps || {});
      const afterStepsKeys = Object.keys(after.steps || {});
      if (JSON.stringify(beforeStepsKeys.sort()) !== JSON.stringify(afterStepsKeys.sort())) {
        differences.push(`steps: ${beforeStepsKeys.length} → ${afterStepsKeys.length} contenedores`);
      }
      
      return differences.length > 0 
        ? `Diferencias encontradas:\n${differences.join('\n')}`
        : 'Estructura similar pero contenido diferente';
    } catch (error) {
      return `Error al comparar: ${error instanceof Error ? error.message : 'Error desconocido'}`;
    }
  }
  
  /**
   * Toggle del panel de debugging
   */
  toggleDebugPanel(): void {
    this.showDebugPanel = !this.showDebugPanel;
    
    if (this.showDebugPanel) {
      // Actualizar preview del JSON actual
      this.jsonPreview = this.exportFlowToJson();
      
      // Ejecutar validación si hay datos
      if (this.flowData) {
        this.validationResult = this.flowValidator.validateFlow(this.flowData);
        this.updateContainerErrors();
      }
    }
  }
  
  /**
   * Convierte los datos del log a string
   */
  getLogDataString(data: any): string {
    if (!data) return '';
    try {
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return String(data);
    }
  }
  
  /**
   * Toggle del modal de previsualización de JSON de targets
   */
  toggleTargetsJsonModal(): void {
    this.showTargetsJsonModal = !this.showTargetsJsonModal;
  }
  
  /**
   * Convierte los datos de targets a string JSON formateado
   */
  getTargetsJsonString(): string {
    if (!this.targetsJsonData) return '';
    try {
      return JSON.stringify(this.targetsJsonData, null, 2);
    } catch (e) {
      return String(this.targetsJsonData);
    }
  }
  
  /**
   * Copia el JSON de targets al portapapeles
   */
  copyTargetsJson(): void {
    if (!this.targetsJsonData) return;
    
    const jsonString = this.getTargetsJsonString();
    navigator.clipboard.writeText(jsonString).then(() => {
      // Mostrar mensaje de éxito (puedes usar un toast o alert)
      alert('JSON copiado al portapapeles');
    }).catch(err => {
      console.error('Error al copiar al portapapeles:', err);
      alert('Error al copiar al portapapeles');
    });
  }
} 