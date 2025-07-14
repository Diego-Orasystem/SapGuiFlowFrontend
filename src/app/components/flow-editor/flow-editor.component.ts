import { Component, OnInit, Input, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FlowService } from '../../services/flow.service';
import { FileService } from '../../services/file.service';
import { TargetsService, SapTarget } from '../../services/targets.service';
import { FlowNode, Connection, SapFlow } from '../../models/flow.model';
import { TargetSelectorComponent } from '../target-selector/target-selector.component';
import { Subscription } from 'rxjs';

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
  canvasHeight: string = '500px';
  
  // Variables para modo oscuro/claro y configuración de visualización
  isDarkMode: boolean = true;
  showMinimap: boolean = false;
  showNodeLabels: boolean = true;
  
  flowElements = [
    { type: 'action', label: 'Acción', icon: 'bi-play-circle' },
    { type: 'decision', label: 'Decisión', icon: 'bi-diamond' },
    { type: 'subflow', label: 'Subflujo', icon: 'bi-diagram-3' }
  ];
  
  flowNodes: FlowNode[] = [];
  connections: Connection[] = [];
  selectedNode: FlowNode | null = null;
  isDragging = false;
  
  // Variables para el gestor de subflujos
  showSubflowManager: boolean = false;
  subflowSearchTerm: string = '';
  filteredSubflows: FlowNode[] = [];
  selectedSubflow: FlowNode | null = null;
  
  // Variables para el editor visual de subflujos
  showSubflowEditor: boolean = false;
  editingSubflow: any = null;
  
  // Variables para el acordeón
  accordionState: {[key: string]: boolean} = {
    buttons: true,
    spacing: true,
    types: true,
    subflows: false,
    targets: true   // Acordeón de targets abierto por defecto
  };
  
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
    private targetsService: TargetsService,
    private elementRef: ElementRef
  ) { }

  ngOnInit(): void {
    // Suscribirse a cambios en el flujo actual
    this.subscriptions.push(
      this.flowService.getCurrentFlow().subscribe(flow => {
        if (flow) {
          this.flowNodes = flow.nodes;
          this.filteredFlowNodes = [...this.flowNodes]; // Mostrar todos los nodos
          this.connections = flow.connections;
          
          // Limpiar caché cuando se cargan nuevos nodos (deshabilitado temporalmente)
          // this.containerNodeCache.clear();
          
          // Layout automático deshabilitado para evitar problemas de rendimiento
          // Los nodos se cargarán en sus posiciones originales
          // El usuario puede aplicar layout manualmente si lo desea
          
          // Inicializar la lista de subflujos
          this.filterSubflows();
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
            console.log('Importando flujo desde archivo:', file.name);
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
    
    // Inicializar el acordeón
    this.accordionState = {
      buttons: true,
      types: true,
      subflows: false,
      targets: true  // Mostrar el acordeón de targets abierto por defecto
    };
    
    // Inicializar tcode por defecto
    this.currentTcode = 'KSB1';
    
    // Cargar targets para el tcode por defecto
    this.loadAvailableTargets();
    
    // Funcionalidad de filtros por ControlType eliminada
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
    this.flowService.importSapFlow(jsonContent, name);
    this.flowCode = jsonContent;
    this.lastImportedContent = jsonContent;
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
      case 'subflow': return 'bi-diagram-3';
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
    this.canvasHeight = this.fullscreenHeight;
    
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
    this.canvasHeight = this.originalHeight;
    
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
      this.canvasHeight = this.originalHeight;
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
        // Crear un nuevo nodo
        this.addNode(type as 'action' | 'decision' | 'subflow', this.snapToGrid(x), this.snapToGrid(y));
      } else if (nodeId) {
        // Mover un nodo existente
        const node = this.flowNodes.find(n => n.id === nodeId);
        if (node) {
          node.x = this.snapToGrid(x);
          node.y = this.snapToGrid(y);
          this.flowService.updateNode(node);
        }
      }
    }
  }
  
  addNode(type: 'action' | 'decision' | 'subflow', x: number, y: number): void {
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
          type: nodeData.type as 'action' | 'decision' | 'subflow',
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
    this.flowCode = this.exportFlowToJson();
    this.isEditing = true;
  }
  
  // Método para activar/desactivar la cuadrícula
  toggleGrid(): void {
    const canvas = this.elementRef.nativeElement.querySelector('.flow-canvas');
    if (canvas) {
      canvas.classList.toggle('grid-visible');
    }
  }
  
  // Métodos para el gestor de subflujos
  toggleSubflowManager(): void {
    this.toggleAccordion('subflows');
  }
  
  filterSubflows(): void {
    // Obtener todos los nodos de tipo subflujo
    const allSubflows = this.flowNodes.filter(node => 
      node.type === 'subflow' || (node.data && node.data.action === 'callSubflow')
    );
    
    if (!this.subflowSearchTerm || this.subflowSearchTerm.trim() === '') {
      this.filteredSubflows = allSubflows;
    } else {
      const searchTerm = this.subflowSearchTerm.toLowerCase();
      this.filteredSubflows = allSubflows.filter(subflow => {
        const label = (subflow.label || '').toLowerCase();
        const name = ((subflow.data?.name) || '').toLowerCase();
        const target = ((subflow.data?.target) || '').toLowerCase();
        
        return label.includes(searchTerm) || 
               name.includes(searchTerm) || 
               target.includes(searchTerm);
      });
    }
    
    // Si hay un subflujo seleccionado que ya no está en la lista filtrada, deseleccionarlo
    if (this.selectedSubflow && !this.filteredSubflows.some(sf => sf.id === this.selectedSubflow?.id)) {
      this.selectedSubflow = null;
    }
  }
  
  selectSubflow(subflow: FlowNode): void {
    this.selectedSubflow = subflow;
    
    // También seleccionamos el nodo para mostrar sus propiedades en el panel inferior
    this.selectNode(subflow);
    
    // Centrar el canvas en el subflujo seleccionado
    setTimeout(() => {
      this.centerOnNode(subflow);
    }, 100);
  }
  
  editSelectedSubflow(): void {
    if (this.selectedSubflow) {
      this.editingNodeId = this.selectedSubflow.id;
      this.openNodeJsonEditor();
    }
  }
  
  // Métodos para el editor visual de subflujos
  openSubflowEditor(): void {
    if (!this.selectedSubflow) return;
    
    // Crear una copia del subflujo seleccionado para editar
    this.editingSubflow = JSON.parse(JSON.stringify(this.selectedSubflow));
    
    // Asegurar que la estructura de datos es correcta
    if (!this.editingSubflow.data) {
      this.editingSubflow.data = {};
    }
    
    // Asegurar que hay un array de acciones
    if (!this.editingSubflow.data.actions) {
      this.editingSubflow.data.actions = [];
    }
    
    // Mostrar el editor
    this.showSubflowEditor = true;
  }
  
  closeSubflowEditor(): void {
    this.showSubflowEditor = false;
    this.editingSubflow = null;
  }
  
  saveSubflowChanges(): void {
    if (!this.editingSubflow || !this.selectedSubflow) return;
    
    // Actualizar el subflujo original con los cambios realizados
    const index = this.flowNodes.findIndex(node => node.id === this.selectedSubflow!.id);
    if (index !== -1) {
      this.flowNodes[index] = this.editingSubflow;
      this.selectedSubflow = this.editingSubflow;
      
      // Actualizar la lista filtrada
      this.filterSubflows();
    }
    
    // Cerrar el editor
    this.closeSubflowEditor();
  }
  
  addSubflowAction(): void {
    if (!this.editingSubflow || !this.editingSubflow.data) return;
    
    // Añadir una nueva acción con valores por defecto
    const newAction = {
      action: 'click',
      target: '',
      value: ''
    };
    
    if (!this.editingSubflow.data.actions) {
      this.editingSubflow.data.actions = [];
    }
    
    this.editingSubflow.data.actions.push(newAction);
  }
  
  removeSubflowAction(index: number): void {
    if (!this.editingSubflow || !this.editingSubflow.data || !this.editingSubflow.data.actions) return;
    
    // Eliminar la acción en el índice especificado
    this.editingSubflow.data.actions.splice(index, 1);
  }
  
  duplicateSelectedSubflow(): void {
    if (!this.selectedSubflow) return;
    
    // Crear una copia del subflujo seleccionado
    const originalSubflow = this.selectedSubflow;
    const newSubflow: FlowNode = {
      ...JSON.parse(JSON.stringify(originalSubflow)), // Deep copy
      id: 'subflow_' + Date.now(), // Generar nuevo ID
      x: originalSubflow.x + 50, // Desplazar ligeramente para visibilidad
      y: originalSubflow.y + 50
    };
    
    // Si tiene una etiqueta, añadir indicación de copia
    if (newSubflow.label) {
      newSubflow.label += ' (copia)';
    }
    
    // Añadir el nuevo subflujo al flujo
    this.flowNodes.push(newSubflow);
    
    // Seleccionar el nuevo subflujo
    this.selectSubflow(newSubflow);
    
    // Actualizar la lista filtrada
    this.filterSubflows();
  }
  
  createNewSubflow(): void {
    // Encontrar una posición adecuada para el nuevo subflujo
    // Por defecto, lo colocamos en el centro del canvas visible
    const canvas = this.elementRef.nativeElement.querySelector('.flow-canvas');
    let x = 100, y = 100;
    
    if (canvas) {
      const canvasRect = canvas.getBoundingClientRect();
      x = (canvasRect.width / 2 - this.panOffsetX) / this.zoomLevel;
      y = (canvasRect.height / 2 - this.panOffsetY) / this.zoomLevel;
    }
    
    // Crear un nuevo subflujo
    const newSubflow: FlowNode = {
      id: 'subflow_' + Date.now(),
      type: 'subflow',
      label: 'Nuevo Subflujo',
      x: Math.round(x),
      y: Math.round(y),
      data: {
        action: 'callSubflow',
        name: 'NuevoSubflujo',
        description: 'Nuevo subflujo creado desde el gestor'
      }
    };
    
    // Añadir el nuevo subflujo al flujo
    this.flowNodes.push(newSubflow);
    
    // Seleccionar el nuevo subflujo
    this.selectSubflow(newSubflow);
    
    // Actualizar la lista filtrada
    this.filterSubflows();
    
    // Abrir el editor de JSON para que el usuario pueda configurarlo
    this.editSelectedSubflow();
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
  
  // Métodos de filtrado por ControlType eliminados

  // ===== MÉTODOS PARA TARGETS =====

  // Abrir selector de targets para editar un nodo
  openTargetSelector(node: FlowNode): void {
    this.selectedNode = node;
    this.targetSelectorMode = 'edit';
    this.showTargetSelector = true;
    
    // Extraer tcode del nodo o usar uno por defecto
    this.currentTcode = this.extractTcodeFromNode(node) || 'KSB1';
    
    // Cargar targets para el tcode
    this.targetsService.loadTargetsForTcode(this.currentTcode).subscribe();
  }

  // Abrir selector de targets para crear un nuevo nodo
  openTargetSelectorForNewNode(tcode: string = 'KSB1'): void {
    this.currentTcode = tcode;
    this.targetSelectorMode = 'create';
    this.showTargetSelector = true;
    
    // Cargar targets para el tcode
    this.targetsService.loadTargetsForTcode(this.currentTcode).subscribe();
  }

  // Cerrar selector de targets
  closeTargetSelector(): void {
    this.showTargetSelector = false;
    this.selectedTarget = null;
    this.targetsService.clearCurrentTargets();
  }

  // Manejar selección de target
  onTargetSelected(target: SapTarget): void {
    this.selectedTarget = target;
    
    // Manejar selección para sub-acciones
    if (this.editingSubAction) {
      this.onSubActionTargetSelected(target);
      return;
    }
    
    if (this.targetSelectorMode === 'edit' && this.selectedNode) {
      // Actualizar el nodo existente
      this.updateNodeWithTarget(this.selectedNode, target);
    } else if (this.targetSelectorMode === 'create') {
      // Crear nuevo nodo con el target
      this.createNodeWithTarget(target);
    }
  }

  // Manejar validación de target
  onTargetValidated(isValid: boolean): void {
    // Aquí se puede manejar la validación del target
    console.log('Target validado:', isValid);
  }

  // Actualizar nodo con target seleccionado
  updateNodeWithTarget(node: FlowNode, target: SapTarget): void {
    if (!node.data) {
      node.data = {};
    }
    
    node.data.target = target.Id;
    node.data.targetName = target.FriendlyName;
    node.data.controlType = target.ControlType;
    
    // Actualizar label del nodo
    node.label = target.FriendlyName || node.label;
    
    // Sugerir acción basada en el tipo de control
    if (!node.data.action) {
      node.data.action = this.suggestActionForControlType(target.ControlType);
    }
    
    // Invalidar caché del nodo antes de actualizar
    this.invalidateNodeCache(node.id);
    
    this.flowService.updateNode(node);
    this.closeTargetSelector();
  }

  // Crear nuevo nodo con target
  createNodeWithTarget(target: SapTarget): void {
    const nodeType = this.suggestNodeTypeForControlType(target.ControlType);
    const action = this.suggestActionForControlType(target.ControlType);
    
    // Crear nodo en el centro del canvas
    const newNode = this.flowService.addNode(nodeType, 300, 200);
    
    // Configurar el nodo con el target
    newNode.data = {
      target: target.Id,
      targetName: target.FriendlyName,
      controlType: target.ControlType,
      action: action
    };
    
    newNode.label = target.FriendlyName;
    
    this.flowService.updateNode(newNode);
    this.closeTargetSelector();
  }

  // Extraer tcode de un nodo
  extractTcodeFromNode(node: FlowNode): string | null {
    // Intentar extraer tcode del target ID o de los datos del nodo
    if (node.data?.target) {
      // Los targets SAP suelen tener el tcode en su estructura
      // Por ahora, usaremos un tcode por defecto
      return 'KSB1';
    }
    return null;
  }

  // Sugerir tipo de nodo basado en el tipo de control
  suggestNodeTypeForControlType(controlType: string): 'action' | 'decision' | 'subflow' {
    switch (controlType) {
      case 'GuiButton':
        return 'action';
      case 'GuiCheckBox':
      case 'GuiRadioButton':
        return 'decision';
      default:
        return 'action';
    }
  }

  // Sugerir acción basada en el tipo de control
  suggestActionForControlType(controlType: string): string {
    switch (controlType) {
      case 'GuiButton':
        return 'click';
      case 'GuiTextField':
      case 'GuiCTextField':
        return 'set';
      case 'GuiCheckBox':
        return 'set';
      case 'GuiComboBox':
        return 'select';
      case 'GuiModalWindow':
      case 'GuiMainWindow':
        return 'waitFor';
      default:
        return 'click';
    }
  }

  // Cambiar tcode actual
  changeTcode(tcode: string): void {
    console.log('Cambiando tcode a:', tcode);
    this.currentTcode = tcode;
    this.loadAvailableTargets();
  }

  // Cargar targets disponibles para el tcode actual
  loadAvailableTargets(): void {
    if (!this.currentTcode) return;
    
    this.targetsService.loadTargetsForTcode(this.currentTcode).subscribe({
      next: (response) => {
        console.log('Targets cargados en FlowEditor:', response);
        if (response && response.controlsByGroup) {
          // Convertir el objeto de targets a array
          this.availableTargets = Object.values(response.controlsByGroup).flat();
          console.log('Available targets:', this.availableTargets);
        } else {
          this.availableTargets = [];
        }
      },
      error: (error) => {
        console.error('Error al cargar targets en FlowEditor:', error);
        this.availableTargets = [];
      }
    });
  }

  // Seleccionar un target de la lista
  selectTargetFromList(target: SapTarget): void {
    this.selectedTarget = target;
    console.log('Target seleccionado:', target);
    
    // Si hay un nodo seleccionado, aplicar el target
    if (this.selectedNode) {
      this.updateNodeWithTarget(this.selectedNode, target);
    }
  }

  // Cache para mejorar el rendimiento
  private containerNodeCache = new Map<string, boolean>();

  // Método para invalidar el caché de un nodo específico
  private invalidateNodeCache(nodeId: string): void {
    this.containerNodeCache.delete(nodeId);
  }

  // Métodos para manejar containers y sub-acciones
  isContainerNode(node: FlowNode | undefined): boolean {
    if (!node || !node.data) return false;
    
    // Deshabilitar temporalmente para evitar problemas de rendimiento
    // Solo usar el tipo del nodo
    return node.type === 'subflow';
  }

  getContainerStepsCount(node: FlowNode): number {
    if (!node.data) return 0;
    
    const nodeData = node.data as any;
    const excludedKeys = ['action', 'target', 'paramKey', 'method', 'timeout', 'operator', 'next'];
    
    return Object.keys(nodeData).filter(key => 
      !excludedKeys.includes(key) &&
      typeof nodeData[key] === 'object' && 
      nodeData[key] !== null && 
      nodeData[key].action
    ).length;
  }

  hasSubActions(node: FlowNode): boolean {
    if (!node.data) return false;
    
    const nodeData = node.data as any;
    const excludedKeys = ['action', 'target', 'paramKey', 'method', 'timeout', 'operator', 'next'];
    
    return Object.keys(nodeData).some(key => 
      !excludedKeys.includes(key) &&
      typeof nodeData[key] === 'object' && 
      nodeData[key] !== null && 
      nodeData[key].action
    );
  }

  getSubActionNames(node: FlowNode): string[] {
    if (!node.data) return [];
    
    const nodeData = node.data as any;
    const excludedKeys = ['action', 'target', 'paramKey', 'method', 'timeout', 'operator', 'next'];
    
    return Object.keys(nodeData).filter(key => 
      !excludedKeys.includes(key) &&
      typeof nodeData[key] === 'object' && 
      nodeData[key] !== null && 
      nodeData[key].action
    ).slice(0, 5); // Limitar a 5 para no saturar la vista
  }

  // Método para obtener la información principal de un nodo
  getNodeMainInfo(node: FlowNode): any {
    if (!node.data) return {};
    
    const nodeData = node.data as any;
    return {
      action: nodeData.action,
      target: nodeData.target,
      paramKey: nodeData.paramKey,
      method: nodeData.method,
      timeout: nodeData.timeout,
      operator: nodeData.operator,
      next: nodeData.next
    };
  }

  // Método para obtener el color de la acción
  getActionColor(action: string): string {
    switch (action) {
      case 'click': return '#48bb78'; // Verde
      case 'set': return '#4299e1'; // Azul
      case 'callProgram': return '#ed8936'; // Naranja
      case 'callSubflow': return '#9f7aea'; // Morado
      case 'exit': return '#f56565'; // Rojo
      default: return '#718096'; // Gris
    }
  }

  // Método para manejar click en containers
  onContainerClick(event: MouseEvent, node: FlowNode): void {
    event.stopPropagation();
    
    if (this.isContainerNode(node)) {
      this.editContainerNode(node);
    }
  }

  // Método para editar un nodo container
  editContainerNode(node: FlowNode): void {
    // Seleccionar el nodo
    this.selectedNode = node;
    
    // Mostrar modal de edición de container
    this.showContainerEditor = true;
    this.containerBeingEdited = node;
  }

  // Propiedades para el modal de edición de container
  showContainerEditor = false;
  containerBeingEdited: FlowNode | null = null;

  // Método para cerrar el editor de container
  closeContainerEditor(): void {
    this.showContainerEditor = false;
    this.containerBeingEdited = null;
  }

  // Método para guardar cambios en el container
  saveContainerChanges(): void {
    if (this.containerBeingEdited) {
      // Actualizar el nodo en el flujo
      this.flowService.updateNode(this.containerBeingEdited);
      console.log('Guardando cambios en container:', this.containerBeingEdited);
      this.closeContainerEditor();
    }
  }

  // Método para obtener las sub-acciones de un container
  getContainerSubActions(node: FlowNode): any[] {
    if (!node.data) return [];
    
    const nodeData = node.data as any;
    const excludedKeys = ['action', 'target', 'paramKey', 'method', 'timeout', 'operator', 'next'];
    
    return Object.keys(nodeData)
      .filter(key => 
        !excludedKeys.includes(key) &&
        typeof nodeData[key] === 'object' && 
        nodeData[key] !== null && 
        nodeData[key].action
      )
      .map(key => ({
        key,
        ...nodeData[key]
      }));
  }

  // Propiedades para editar sub-acciones
  editingSubAction: any = null;
  showSubActionEditor = false;
  subActionBackup: any = null;

  // Método para editar una sub-acción
  editSubAction(subAction: any): void {
    console.log('Editando sub-acción:', subAction);
    this.editingSubAction = { ...subAction };
    this.subActionBackup = { ...subAction };
    this.showSubActionEditor = true;
    console.log('Modal de sub-acción abierto:', this.showSubActionEditor);
  }

  // Método para cancelar la edición de sub-acción
  cancelSubActionEdit(): void {
    this.editingSubAction = null;
    this.subActionBackup = null;
    this.showSubActionEditor = false;
  }

  // Método para guardar cambios en sub-acción
  saveSubActionChanges(): void {
    if (this.editingSubAction && this.containerBeingEdited) {
      const nodeData = this.containerBeingEdited.data as any;
      const subActionKey = this.editingSubAction.key;
      
      // Crear o actualizar la sub-acción en el container
      nodeData[subActionKey] = {
        action: this.editingSubAction.action,
        target: this.editingSubAction.target,
        paramKey: this.editingSubAction.paramKey,
        method: this.editingSubAction.method,
        timeout: this.editingSubAction.timeout,
        operator: this.editingSubAction.operator,
        next: this.editingSubAction.next
      };
      
      // Limpiar valores vacíos
      Object.keys(nodeData[subActionKey]).forEach(key => {
        if (nodeData[subActionKey][key] === '' || nodeData[subActionKey][key] === null || nodeData[subActionKey][key] === undefined) {
          delete nodeData[subActionKey][key];
        }
      });
      
      this.cancelSubActionEdit();
    }
  }

  // Método para eliminar una sub-acción
  deleteSubAction(subAction: any): void {
    if (this.containerBeingEdited && confirm(`¿Está seguro de que desea eliminar la sub-acción "${subAction.key}"?`)) {
      const nodeData = this.containerBeingEdited.data as any;
      delete nodeData[subAction.key];
    }
  }

  // Método para añadir una nueva sub-acción
  addNewSubAction(): void {
    console.log('Añadiendo nueva sub-acción');
    this.editingSubAction = {
      key: `NUEVA_${Date.now()}`,
      action: 'click',
      target: '',
      paramKey: '',
      method: '',
      timeout: '',
      operator: '',
      next: ''
    };
    this.showSubActionEditor = true;
    console.log('Modal de nueva sub-acción abierto:', this.showSubActionEditor);
  }

  // Método para obtener tipos de acción disponibles
  getAvailableActionTypes(): string[] {
    return ['click', 'set', 'callProgram', 'callSubflow', 'exit', 'waitFor', 'columns', 'columnsSum'];
  }

  // Método para obtener targets disponibles para el selector
  getAvailableTargetsForSubAction(): any[] {
    if (!this.currentTcode) return [];
    
    // Obtener targets del servicio usando el observable
    let targets: any[] = [];
    this.targetsService.getCurrentTargets().subscribe(response => {
      if (response && response.success) {
        // Recopilar todos los targets de todos los grupos
        Object.values(response.controlsByGroup).forEach(group => {
          targets.push(...group);
        });
      }
    });
    return targets;
  }

  // Método para abrir selector de targets para sub-acción
  openTargetSelectorForSubAction(): void {
    this.targetSelectorMode = 'edit';
    this.showTargetSelector = true;
  }

  // Método para manejar selección de target para sub-acción
  onSubActionTargetSelected(target: any): void {
    if (this.editingSubAction && target) {
      this.editingSubAction.target = target.Id || target.id;
      this.editingSubAction.paramKey = target.FriendlyName || target.friendlyName || target.Id || target.id;
      this.closeTargetSelector();
    }
  }

  // Validar targets en el flujo actual
  validateFlowTargets(): void {
    if (!this.currentTcode) {
      console.warn('No se ha especificado un tcode para validar');
      return;
    }

    // Crear un flujo SAP temporal para validar
    const sapFlow = this.flowService.exportToSapFlow();
    if (!sapFlow) {
      console.warn('No se pudo exportar el flujo actual');
      return;
    }

    // Aquí podrías llamar al endpoint de validación del backend
    console.log('Validando flujo para tcode:', this.currentTcode);
    console.log('Flujo a validar:', sapFlow);
  }
} 