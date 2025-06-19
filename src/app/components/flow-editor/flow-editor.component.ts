import { Component, OnInit, Input, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FlowService } from '../../services/flow.service';
import { FileService } from '../../services/file.service';
import { FlowNode, Connection, SapFlow } from '../../models/flow.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-flow-editor',
  templateUrl: './flow-editor.component.html',
  styleUrls: ['./flow-editor.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule]
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
    types: true,
    subflows: false,
    filters: false  // Añadir nuevo estado para el acordeón de filtros
  };
  
  // Variables para el filtro por tipo de control
  availableControlTypes: string[] = [];
  selectedControlTypes: string[] = [];
  filteredFlowNodes: FlowNode[] = [];
  isFilterActive: boolean = false;
  
  private subscriptions: Subscription[] = [];
  
  constructor(private flowService: FlowService, private fileService: FileService, private elementRef: ElementRef) { }

  ngOnInit(): void {
    // Suscribirse a cambios en el flujo actual
    this.subscriptions.push(
      this.flowService.getCurrentFlow().subscribe(flow => {
        if (flow) {
          this.flowNodes = flow.nodes;
          this.filteredFlowNodes = [...this.flowNodes]; // Inicializar los nodos filtrados
          this.connections = flow.connections;
          
          // Organizar automáticamente los nodos si es la primera carga
          if (this.autoArrangeMode) {
            this.autoArrangeNodes();
          }
          
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
        if (file && file.content) {
          try {
            this.importFlowFromJson(file.content, file.name);
          } catch (error) {
            console.error('Error al cargar el flujo:', error);
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
    
    // Inicializar el acordeón
    this.accordionState = {
      buttons: true,
      types: true,
      subflows: false
    };
    
    // Cargar los tipos de controles disponibles
    this.loadControlTypes();
  }
  
  ngOnDestroy(): void {
    // Cancelar todas las suscripciones al destruir el componente
    this.subscriptions.forEach(sub => sub.unsubscribe());
    
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
    if (jsonContent) {
      this.fileService.getSelectedFile().subscribe(file => {
        if (file) {
          const updatedFile = {
            ...file,
            content: jsonContent
          };
          this.fileService.updateFile(updatedFile).subscribe();
        }
      });
    }
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
    
    // Posicionar los nodos según su nivel
    const nodeWidth = 180;
    const nodeHeight = 100;
    const horizontalSpacing = 100;
    const verticalSpacing = 80;
    
    Object.keys(levels).forEach(levelStr => {
      const level = parseInt(levelStr);
      const nodesInLevel = levels[level];
      
      // Posicionar horizontalmente
      nodesInLevel.forEach((nodeId, index) => {
        const node = this.flowNodes.find(n => n.id === nodeId);
        if (node) {
          node.x = 50 + level * (nodeWidth + horizontalSpacing);
          node.y = 50 + index * (nodeHeight + verticalSpacing);
          
          // Actualizar el nodo en el servicio
          this.flowService.updateNode(node);
        }
      });
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
      maxX = Math.max(maxX, node.x + 180); // Ancho del nodo
      maxY = Math.max(maxY, node.y + 100); // Altura aproximada del nodo
    });
    
    const canvasWidth = 800; // Ancho aproximado del canvas
    const canvasHeight = 500; // Altura aproximada del canvas
    
    // Calcular offsets para centrar
    this.panOffsetX = (canvasWidth - (maxX - minX)) / 2 - minX;
    this.panOffsetY = (canvasHeight - (maxY - minY)) / 2 - minY;
  }
  
  // Ajustar la posición de un nodo a la cuadrícula
  snapToGrid(value: number): number {
    return Math.round(value / this.gridSize) * this.gridSize;
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
  
  // Método para activar/desactivar filtros por tipo de control
  toggleControlTypeFilter(controlType: string): void {
    const index = this.selectedControlTypes.indexOf(controlType);
    
    if (index === -1) {
      // Añadir el tipo de control a los seleccionados
      this.selectedControlTypes.push(controlType);
    } else {
      // Eliminar el tipo de control de los seleccionados
      this.selectedControlTypes.splice(index, 1);
    }
    
    // Aplicar los filtros
    this.applyFilters();
  }
  
  // Método para aplicar los filtros seleccionados
  applyFilters(): void {
    if (this.selectedControlTypes.length === 0) {
      // Si no hay filtros seleccionados, mostrar todos los nodos
      this.filteredFlowNodes = [...this.flowNodes];
      this.isFilterActive = false;
    } else {
      // Filtrar los nodos por tipo de control
      this.filteredFlowNodes = this.flowNodes.filter(node => {
        // Si el nodo tiene un tipo de control específico en sus datos
        if (node.data && node.data.controlType) {
          return this.selectedControlTypes.includes(node.data.controlType);
        }
        return false;
      });
      this.isFilterActive = true;
    }
    
    console.log('Nodos filtrados:', this.filteredFlowNodes.length);
  }
  
  // Método para resetear los filtros
  resetFilters(): void {
    this.selectedControlTypes = [];
    this.filteredFlowNodes = [...this.flowNodes];
    this.isFilterActive = false;
  }
} 