import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Flow, FlowNode, Connection, SapFlow, convertSapFlowToVisualFlow } from '../models/flow.model';

@Injectable({
  providedIn: 'root'
})
export class FlowService {
  private currentFlowSubject = new BehaviorSubject<Flow | null>(null);
  private selectedNodeSubject = new BehaviorSubject<FlowNode | null>(null);
  
  private nodeIdCounter = 0;
  private connectionIdCounter = 0;
  
  constructor() { }

  // Getters para observables
  getCurrentFlow(): Observable<Flow | null> {
    return this.currentFlowSubject.asObservable();
  }

  getSelectedNode(): Observable<FlowNode | null> {
    return this.selectedNodeSubject.asObservable();
  }

  // Métodos para manipulación del flujo
  createFlow(name: string): Flow {
    const newFlow: Flow = {
      id: this.generateId(),
      name,
      nodes: [],
      connections: []
    };
    
    this.currentFlowSubject.next(newFlow);
    return newFlow;
  }

  loadFlow(flow: Flow): void {
    this.currentFlowSubject.next(flow);
  }

  addNode(type: 'action' | 'decision' | 'subflow', x: number, y: number): FlowNode {
    const currentFlow = this.currentFlowSubject.value;
    if (!currentFlow) {
      throw new Error('No hay un flujo activo');
    }
    
    const newNode: FlowNode = {
      id: `node-${++this.nodeIdCounter}`,
      type,
      label: `${type.charAt(0).toUpperCase() + type.slice(1)} ${this.nodeIdCounter}`,
      x,
      y
    };
    
    currentFlow.nodes.push(newNode);
    this.currentFlowSubject.next({...currentFlow});
    
    return newNode;
  }

  updateNode(node: FlowNode): void {
    const currentFlow = this.currentFlowSubject.value;
    if (!currentFlow) {
      return;
    }
    
    const index = currentFlow.nodes.findIndex(n => n.id === node.id);
    if (index > -1) {
      currentFlow.nodes[index] = {...node};
      this.currentFlowSubject.next({...currentFlow});
    }
  }

  deleteNode(nodeId: string): void {
    const currentFlow = this.currentFlowSubject.value;
    if (!currentFlow) {
      return;
    }
    
    // Eliminar el nodo
    currentFlow.nodes = currentFlow.nodes.filter(n => n.id !== nodeId);
    
    // Eliminar conexiones asociadas
    currentFlow.connections = currentFlow.connections.filter(
      c => c.sourceId !== nodeId && c.targetId !== nodeId
    );
    
    this.currentFlowSubject.next({...currentFlow});
    
    // Si el nodo eliminado estaba seleccionado, limpiar la selección
    if (this.selectedNodeSubject.value?.id === nodeId) {
      this.selectedNodeSubject.next(null);
    }
  }

  addConnection(sourceId: string, targetId: string): Connection {
    const currentFlow = this.currentFlowSubject.value;
    if (!currentFlow) {
      throw new Error('No hay un flujo activo');
    }
    
    const newConnection: Connection = {
      id: `conn-${++this.connectionIdCounter}`,
      sourceId,
      targetId
    };
    
    currentFlow.connections.push(newConnection);
    this.currentFlowSubject.next({...currentFlow});
    
    return newConnection;
  }

  deleteConnection(connectionId: string): void {
    const currentFlow = this.currentFlowSubject.value;
    if (!currentFlow) {
      return;
    }
    
    currentFlow.connections = currentFlow.connections.filter(c => c.id !== connectionId);
    this.currentFlowSubject.next({...currentFlow});
  }

  setSelectedNode(node: FlowNode | null): void {
    this.selectedNodeSubject.next(node);
  }

  // Importar flujo desde formato JSON de SAP
  importSapFlow(jsonContent: string, name: string): Flow | null {
    try {
      const parsedJson = JSON.parse(jsonContent);
      
      // Verificar si el JSON tiene la estructura esperada (steps)
      if (parsedJson && parsedJson.steps) {
        const sapFlow: SapFlow = parsedJson;
        const flow = convertSapFlowToVisualFlow(sapFlow, name);
        
        // Actualizar contadores de IDs
        this.updateIdCounters(flow);
        
        // Cargar el flujo
        this.loadFlow(flow);
        return flow;
      }
      return null;
    } catch (error) {
      console.error('Error al importar el flujo SAP:', error);
      return null;
    }
  }

  // Exportar flujo actual al formato JSON de SAP
  exportToSapFlow(): SapFlow | null {
    const currentFlow = this.currentFlowSubject.value;
    if (!currentFlow) {
      return null;
    }
    
    const sapFlow: SapFlow = {
      steps: {}
    };
    
    // Convertir nodos y conexiones a formato SAP
    currentFlow.nodes.forEach(node => {
      // Encontrar la conexión saliente de este nodo
      const outConnection = currentFlow.connections.find(conn => conn.sourceId === node.id);
      const nextStep = outConnection ? outConnection.targetId : undefined;
      
      sapFlow.steps[node.id] = {
        action: node.data?.action || this.getDefaultActionForType(node.type),
        target: node.data?.target,
        paramKey: node.data?.paramKey,
        method: node.data?.method,
        next: nextStep
      };
    });
    
    return sapFlow;
  }

  // Obtener acción predeterminada según el tipo de nodo
  private getDefaultActionForType(type: string): string {
    switch (type) {
      case 'action': return 'click';
      case 'decision': return 'set';
      case 'subflow': return 'callSubflow';
      default: return 'click';
    }
  }

  // Actualizar contadores de IDs basados en el flujo cargado
  private updateIdCounters(flow: Flow): void {
    // Actualizar contador de nodos
    flow.nodes.forEach(node => {
      const idMatch = node.id.match(/node-(\d+)/);
      if (idMatch && parseInt(idMatch[1]) > this.nodeIdCounter) {
        this.nodeIdCounter = parseInt(idMatch[1]);
      }
    });
    
    // Actualizar contador de conexiones
    flow.connections.forEach(conn => {
      const idMatch = conn.id.match(/conn-(\d+)/);
      if (idMatch && parseInt(idMatch[1]) > this.connectionIdCounter) {
        this.connectionIdCounter = parseInt(idMatch[1]);
      }
    });
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }
} 