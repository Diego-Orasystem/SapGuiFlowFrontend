import { Component, OnInit, Input, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FlowService } from '../../services/flow.service';
import { FileService } from '../../services/file.service';
import { SftpService } from '../../services/sftp.service';
import { FlowNode, Connection, SapFlow } from '../../models/flow.model';
import { TargetSelectorComponent } from '../target-selector/target-selector.component';
import { Subscription } from 'rxjs';

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
export class FlowEditorComponent implements OnInit {
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
    console.log('getAvailableTargetContexts llamado. availableTargets:', this.availableTargets.map(t => ({ key: t.key, friendlyName: t.friendlyName })));
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

    // Extraer nombre base del flujo (sin extensión)
    const flowNameBase = flowFileName.replace('.json', '').toUpperCase();
    console.log('flowNameBase:', flowNameBase);
    
    // Construir nombre del archivo de targets
    const targetFileName = `${flowNameBase}-targets.json`;
    console.log('Buscando archivo de targets:', targetFileName);
    
    // Buscar el archivo de targets en la lista
    this.loadingTargets = true;
    this.sftpService.listTargets().subscribe({
      next: (response) => {
        this.loadingTargets = false;
        if (response.status && response.files) {
          console.log('Archivos encontrados:', response.files.map(f => f.name));
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
                    console.log('loadTargetsForCurrentFlow - targetsData cargado:', Object.keys(targetsData.TargetControls || {}));
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
              }
            });
          } else {
            console.log(`No se encontró archivo de targets para el flujo: ${targetFileName}`);
            console.log('Archivos disponibles:', response.files.map(f => f.name));
          }
        } else {
          console.error('Error en respuesta de listTargets:', response.message);
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
    console.log('processTargetsFromFile llamado con flowNameBase:', flowNameBase);
    // El archivo contiene un objeto con la estructura: { Tcode, Generated, TargetControls: { ... } }
    if (typeof targetsData === 'object' && !Array.isArray(targetsData)) {
      // Usar el path proporcionado o construir uno por defecto
      const filePath = targetFilePath || `~/lek-files/can/sap-config/sap-gui-flow/sap-targets$/${flowNameBase}-targets.json`;
      
      // Procesar TargetControls si existe
      if (targetsData.TargetControls && typeof targetsData.TargetControls === 'object') {
        const targetKeys = Object.keys(targetsData.TargetControls);
        console.log('TargetKeys encontrados:', targetKeys);
        
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
        
        console.log('availableTargets después de processTargetsFromFile:', this.availableTargets.map(t => ({ key: t.key, friendlyName: t.friendlyName })));
        
        // Si hay targets disponibles y no hay uno seleccionado, seleccionar el primero
        if (targetKeys.length > 0 && !this.selectedTargetContext) {
          const firstTargetKey = targetKeys[0];
          console.log('Seleccionando automáticamente el primer target:', firstTargetKey);
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
    console.log('loadAllAvailableTargets - Cargando todos los targets disponibles');
    this.loadingTargets = true;
    this.availableTargets = [];

    this.sftpService.listTargets().subscribe({
      next: (response) => {
        if (response.status && response.files) {
          const targetFiles = response.files.filter(file => !file.isDirectory && file.name.endsWith('.json'));
          console.log('Archivos de targets encontrados:', targetFiles.map(f => f.name));

          if (targetFiles.length === 0) {
            this.loadingTargets = false;
            return;
          }

          // Cargar contenido de cada archivo de targets
          let loadedCount = 0;
          targetFiles.forEach(targetFile => {
            this.sftpService.getTargetContent(targetFile.path).subscribe({
              next: (targetResponse) => {
                if (targetResponse.status && targetResponse.content) {
                  try {
                    const targetsData = JSON.parse(targetResponse.content);
                    
                    // Extraer todos los FriendlyName de TargetControls
                    if (targetsData.TargetControls && typeof targetsData.TargetControls === 'object') {
                      Object.keys(targetsData.TargetControls).forEach(friendlyName => {
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
                }
                
                loadedCount++;
                if (loadedCount === targetFiles.length) {
                  this.loadingTargets = false;
                  console.log('loadAllAvailableTargets - Targets cargados:', this.availableTargets.map(t => t.friendlyName));
                }
              },
              error: (error) => {
                console.error('Error al cargar contenido de target:', targetFile.name, error);
                loadedCount++;
                if (loadedCount === targetFiles.length) {
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
      console.log('Targets disponibles:', this.availableTargets.map(t => ({ key: t.key, friendlyName: t.friendlyName })));
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
   * Procesa los controles desde el archivo de targets y filtra los manipulables
   */
  processControlsFromTargetFile(targetControls: any[]): void {
    this.loadingControls = false;
    
    console.log('Procesando controles desde archivo:', targetControls?.length, 'controles totales');
    
    // Tipos de controles manipulables
    const manipulableTypes = [
      'GuiButton',
      'GuiCheckBox',
      'GuiRadioButton',
      'GuiCTextField',
      'GuiTextField',
      'GuiComboBox',
      'GuiComboBoxField',
      'GuiListBox',
      'GuiTab',
      'GuiToggleButton',
      'GuiToolbarButton',
      'GuiGridToolbarButton'
    ];
    
    // Filtrar y mapear controles manipulables
    const filteredControls = targetControls
      .filter(control => {
        const controlType = control.ControlType || control.controlType;
        const isManipulable = manipulableTypes.includes(controlType);
        if (!isManipulable) {
          console.log('Control no manipulable:', controlType, control.FriendlyName || control.friendlyName);
        }
        return isManipulable;
      })
      .map(control => ({
        name: control.Id || control.id || control.FriendlyName || control.friendlyName,
        friendlyName: control.FriendlyName || control.friendlyName || control.Id || control.id,
        controlType: control.ControlType || control.controlType,
        path: control.Id || control.id || '',
        isManipulable: true
      }));
    
    console.log('Controles manipulables encontrados:', filteredControls.length);
    console.log('Ejemplos de controles:', filteredControls.slice(0, 5));
    
    this.targetContextControls = filteredControls;
    
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
          // El backend ya filtra los controles manipulables, pero podemos hacer un filtro adicional si es necesario
          this.targetContextControls = response.controls.filter(control => control.isManipulable);
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

    let container: TargetContainer | null = null;

    // Si hay un contenedor seleccionado y el control es del mismo contexto
    if (this.selectedContainer && this.selectedContainer.targetContextKey === this.selectedTargetContext) {
      // Agregar al contenedor seleccionado
      container = this.selectedContainer;
    } else {
      // Si no hay contenedor seleccionado o es de otro contexto, crear uno nuevo
      // Verificar si ya existe una instancia de este contexto
      const existingContainers = this.targetContainers.filter(
        c => c.targetContextKey === this.selectedTargetContext
      );

      // Determinar el número de instancia
      const instanceNumber = existingContainers.length > 0 
        ? Math.max(...existingContainers.map(c => c.instanceNumber)) + 1 
        : 1;

      // Crear nuevo contenedor con instancia
      const friendlyName = this.getTargetContextFriendlyName(this.selectedTargetContext!) || this.selectedTargetContext!;
      container = this.createTargetContainer(this.selectedTargetContext!, friendlyName, instanceNumber);
      this.targetContainers.push(container);
      
      // Conectar con el contenedor anterior si existe
      if (this.selectedContainer) {
        this.connectContainers(this.selectedContainer.id, container.id);
      }
      
      // Actualizar colores después de agregar contenedor
      this.updateContainerColors();
    }

    // Agregar control al contenedor
    const controlNode = this.createControlNode(control, container);
    container.controls.push(controlNode);
    this.targetContextNodes.push(controlNode);
    
    // Actualizar tamaño del contenedor
    this.updateContainerSize(container);
    
    // Organizar controles dentro del contenedor
    this.arrangeControlsInContainer(container);
    
    this.selectContainer(container);
    console.log('Control agregado al contenedor:', controlNode);
  }

  /**
   * Crea un nuevo contenedor de target
   */
  createTargetContainer(targetContextKey: string, friendlyName: string, instanceNumber: number = 1): TargetContainer {
    // Posicionar contenedores en grid
    const containerCount = this.targetContainers.length;
    const colsPerRow = 2;
    const containerWidth = 400;
    const containerHeight = 200;
    // Espaciado aumentado para evitar superposiciones
    const spacingX = 500; // Aumentado de 450 a 500
    const spacingY = 400; // Aumentado de 350 a 400 (se ajustará dinámicamente en arrangeContainers)
    
    const col = containerCount % colsPerRow;
    const row = Math.floor(containerCount / colsPerRow);
    
    // Generar clave completa con instancia (ej: "SCAREA::1")
    const fullKey = instanceNumber > 1 ? `${targetContextKey}::${instanceNumber}` : targetContextKey;
    
    const container: TargetContainer = {
      id: `container_${fullKey}_${Date.now()}`,
      targetContextKey: targetContextKey,
      instanceNumber: instanceNumber,
      fullKey: fullKey,
      friendlyName: friendlyName,
      x: 100 + (col * spacingX),
      y: 100 + (row * spacingY),
      width: containerWidth,
      height: containerHeight,
      controls: [],
      isCollapsed: false,
      colorClass: '' // Se asignará dinámicamente
    };
    
    // Asignar color dinámicamente después de agregar al array
    // Esto se hará en updateContainerColors()
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
   * Obtiene el path SVG para una conexión entre contenedores
   */
  getPathForContainerConnection(sourceId: string, targetId: string): string {
    const sourceContainer = this.targetContainers.find(c => c.id === sourceId);
    const targetContainer = this.targetContainers.find(c => c.id === targetId);
    
    if (!sourceContainer || !targetContainer) {
      return '';
    }
    
    // Calcular puntos de inicio y fin
    const startX = sourceContainer.x + sourceContainer.width;
    const startY = sourceContainer.y + (sourceContainer.height / 2);
    const endX = targetContainer.x;
    const endY = targetContainer.y + (targetContainer.height / 2);
    
    // Crear curva suave
    const midX = (startX + endX) / 2;
    const controlPoint1X = startX + (endX - startX) * 0.5;
    const controlPoint1Y = startY;
    const controlPoint2X = endX - (endX - startX) * 0.5;
    const controlPoint2Y = endY;
    
    return `M ${startX} ${startY} C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${endX} ${endY}`;
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
    const controlIndex = container.controls.length;
    const controlWidth = 180;
    const controlHeight = 100;
    const padding = 20;
    const spacing = 10;
    
    // Posición relativa al contenedor
    const relativeX = padding;
    const relativeY = padding + (controlIndex * (controlHeight + spacing));
    
    return {
      id: `control_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'action',
      label: control.friendlyName || control.name,
      x: container.x + relativeX,
      y: container.y + relativeY,
      data: {
        action: 'set',
        target: control.name,
        controlType: control.controlType,
        path: control.path,
        targetContextKey: container.targetContextKey,
        friendlyName: control.friendlyName,
        containerId: container.id
      }
    };
  }

  /**
   * Actualiza el tamaño del contenedor basado en sus controles
   */
  updateContainerSize(container: TargetContainer): void {
    if (container.controls.length === 0) {
      container.height = 200;
      return;
    }

    const controlHeight = 100;
    const spacing = 10;
    const padding = 20;
    
    const totalControlsHeight = container.controls.length * (controlHeight + spacing) - spacing;
    container.height = totalControlsHeight + (padding * 2);
    
    // Asegurar altura mínima
    if (container.height < 200) {
      container.height = 200;
    }
    
    // Si el contenedor tiene muchos controles, reorganizar el espacio
    // Solo reorganizar si hay más de 3 controles para evitar reorganizaciones innecesarias
    if (container.controls.length > 3) {
      // Reorganizar controles dentro del contenedor
      this.arrangeControlsInContainer(container);
    }
  }

  /**
   * Organiza los controles dentro del contenedor
   */
  arrangeControlsInContainer(container: TargetContainer): void {
    const controlWidth = 180;
    const controlHeight = 100;
    const padding = 20;
    const spacing = 10;
    
    container.controls.forEach((control, index) => {
      control.x = container.x + padding;
      control.y = container.y + padding + (index * (controlHeight + spacing));
    });
    
    this.updateContainerSize(container);
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

    // Eliminar el contenedor
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
      this.isDraggingContainer = true;
      this.selectedContainer = container;
      
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const canvas = this.elementRef.nativeElement.querySelector('.flow-canvas');
      if (canvas) {
        const canvasRect = canvas.getBoundingClientRect();
        this.dragContainerOffset.x = event.clientX - rect.left;
        this.dragContainerOffset.y = event.clientY - rect.top;
      }
    }
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

    // Actualizar tamaño del contenedor
    this.updateContainerSize(container);
    
    // Reorganizar controles restantes
    this.arrangeControlsInContainer(container);

    // Si el contenedor queda vacío, eliminarlo
    if (container.controls.length === 0) {
      this.deleteContainer(container.id);
    }
  }

  /**
   * Genera contenedores visuales desde targetContextData
   */
  generateTargetContextNodes(): void {
    this.targetContextNodes = [];
    this.targetContainers = [];
    
    if (!this.targetContextData) return;
    
    const keys = Object.keys(this.targetContextData);
    keys.forEach((key) => {
      const context = this.targetContextData[key];
      
      // Saltar si el contexto es solo un string (ej: "CHLYT": "Choose Layout")
      if (typeof context === 'string') {
        return;
      }
      
      const friendlyName = typeof context === 'object' && context.FriendlyName 
        ? context.FriendlyName 
        : key;
      
      // Crear contenedor
      const container = this.createTargetContainer(key, friendlyName, 1); // Primera instancia
      this.targetContainers.push(container);
      
      // Procesar deepaliases si existen para crear controles dentro del contenedor
      if (typeof context === 'object' && context.deepaliases) {
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
        
        // Actualizar tamaño del contenedor después de agregar controles
        this.updateContainerSize(container);
      }
    });
    
    // Organizar contenedores en grid
    this.arrangeContainers();
    
    // Actualizar colores después de generar todos los contenedores
    this.updateContainerColors();
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
   * Organiza los contenedores en un grid ordenado con espaciado dinámico
   */
  arrangeContainers(): void {
    const colsPerRow = 2;
    const startX = 100;
    const startY = 100;
    const spacingX = 500; // Espaciado horizontal aumentado
    const minSpacingY = 50; // Espaciado vertical mínimo entre contenedores
    
    // Primero, actualizar el tamaño de todos los contenedores
    this.targetContainers.forEach(container => {
      this.updateContainerSize(container);
    });
    
    // Organizar en grid con espaciado dinámico basado en la altura real
    let currentY = startY;
    let currentRow = 0;
    
    this.targetContainers.forEach((container, index) => {
      const col = index % colsPerRow;
      const row = Math.floor(index / colsPerRow);
      
      // Si cambiamos de fila, ajustar la posición Y
      if (row !== currentRow) {
        // Encontrar la altura máxima de los contenedores en la fila anterior
        const previousRowStart = (currentRow) * colsPerRow;
        const previousRowEnd = Math.min(previousRowStart + colsPerRow, this.targetContainers.length);
        let maxHeightInRow = 0;
        
        for (let i = previousRowStart; i < previousRowEnd; i++) {
          const prevContainer = this.targetContainers[i];
          if (prevContainer && prevContainer.height > maxHeightInRow) {
            maxHeightInRow = prevContainer.height;
          }
        }
        
        // Mover Y basándose en la altura máxima de la fila anterior + espaciado
        currentY += maxHeightInRow + minSpacingY;
        currentRow = row;
      }
      
      container.x = startX + (col * spacingX);
      container.y = currentY;
      
      // Actualizar posiciones de controles dentro del contenedor
      this.arrangeControlsInContainer(container);
    });
    
    // Actualizar colores después de reorganizar
    this.updateContainerColors();
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
  
  // Variables para el selector de targets
  currentTcode: string = 'KSB1';
  showTargetSelector: boolean = false;
  selectedTarget: SapTarget | null = null;
  targetSelectorMode: 'edit' | 'create' = 'edit';
  availableTargets: SapTarget[] = [];
  
  // Variables para el filtro por tipo de control (eliminado)
  filteredFlowNodes: FlowNode[] = [];
  
  private subscriptions: Subscription[] = [];
  
  constructor(
    private flowService: FlowService, 
    private fileService: FileService, 
    private elementRef: ElementRef,
    private sftpService: SftpService
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
        if (file && file.content && !this.isUpdatingFile && file.content !== this.lastImportedContent) {
          try {
            this.currentFlowFileName = file.name; // Guardar nombre del flujo
            // importFlowFromJson ya llama a loadTargetsForCurrentFlow internamente
            this.importFlowFromJson(file.content, file.name);
            this.lastImportedContent = file.content;
          } catch (error) {
            console.error('Error al cargar el flujo:', error);
          }
        } else if (file && file.content) {
          console.log('Importación omitida:', {
            isUpdatingFile: this.isUpdatingFile,
            contentChanged: file.content !== this.lastImportedContent
          });
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
      this.currentFlowFileName = name; // Guardar nombre del flujo
      
      // Extraer steps y targetContext
      if (this.flowData.steps) {
        this.stepsData = this.flowData.steps;
      } else {
        this.stepsData = {};
      }
      
      if (this.flowData.targetContext) {
        this.targetContextData = this.flowData.targetContext;
      } else {
        this.targetContextData = {};
      }
      
      this.flowService.importSapFlow(jsonContent, name);
      this.flowCode = jsonContent;
      
      // Generar nodos visuales para targetContext
      this.generateTargetContextNodes();
      
      // Cargar targets correspondientes al flujo si hay nombre de archivo
      // Esto sobrescribirá cualquier target cargado previamente
      if (name && name !== 'Flujo importado' && name !== 'Flujo nuevo') {
        // Verificar si es un flujo en blanco (empieza con "Nuevo_Flujo_")
        if (name.startsWith('Nuevo_Flujo_')) {
          console.log('importFlowFromJson - Flujo en blanco detectado, cargando todos los targets disponibles');
          // Para flujos en blanco, cargar todos los targets disponibles
          this.availableTargets = [];
          this.selectedTargetContext = null;
          this.targetContextControls = [];
          this.loadAllAvailableTargets();
        } else {
          console.log('importFlowFromJson - Cargando targets para flujo:', name);
          // Limpiar targets anteriores antes de cargar los nuevos
          this.availableTargets = [];
          this.selectedTargetContext = null;
          this.targetContextControls = [];
          // Cargar targets del flujo - esto poblará availableTargets con FriendlyName
          this.loadTargetsForCurrentFlow(name);
        }
      } else {
        console.log('importFlowFromJson - No hay nombre de archivo válido, limpiando targets');
        // Si no hay flujo cargado, limpiar también los targets
        this.availableTargets = [];
        this.selectedTargetContext = null;
        this.targetContextControls = [];
      }
    } catch (error) {
      console.error('Error al parsear JSON:', error);
      this.flowService.importSapFlow(jsonContent, name);
      this.flowCode = jsonContent;
      // Inicializar vacío si hay error
      this.stepsData = {};
      this.targetContextData = {};
    }
  }
  
  exportFlowToJson(): string {
    const sapFlow = this.flowService.exportToSapFlow();
    if (sapFlow) {
      return JSON.stringify(sapFlow, null, 2);
    }
    return '';
  }
  
  saveChanges(): void {
    const jsonContent = this.exportFlowToJson();
    if (!jsonContent) {
      this.showSaveMessage('Error: No se pudo exportar el contenido JSON', 'error');
      return;
    }

    // Validar que el JSON es válido
    try {
      JSON.parse(jsonContent);
    } catch (error) {
      this.showSaveMessage('Error: El contenido JSON generado no es válido', 'error');
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
          content: jsonContent,
          size: new Blob([jsonContent]).size,
          modified: new Date()
        };

        // Debug: Mostrar datos que se envían
        console.log('Datos enviados al backend:', {
          name: updatedFile.name,
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
  
  cancelEditing(): void {
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
  
  onNodeDragStart(event: DragEvent, node: FlowNode): void {
    if (event.dataTransfer) {
      event.dataTransfer.setData('nodeId', node.id);
      this.isDragging = true;
    }
  }
  
  onCanvasDragOver(event: DragEvent): void {
    event.preventDefault();
  }
  
  onCanvasDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
    
    if (event.dataTransfer) {
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
    // Generar JSON de targetContext en lugar de steps
    this.flowCode = this.exportTargetContextToJson();
    this.isEditing = true;
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
} 