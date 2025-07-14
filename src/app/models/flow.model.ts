export interface FlowNode {
    id: string;
    type: 'action' | 'decision' | 'subflow';
    label: string;
    x: number;
    y: number;
    data?: any;
}

export interface Connection {
    id: string;
    sourceId: string;
    targetId: string;
    label?: string;
}

export interface Flow {
    id: string;
    name: string;
    nodes: FlowNode[];
    connections: Connection[];
}

// Modelos para representar el formato JSON del flujo SAP
export interface SapFlowStep {
    action: string;
    target?: string;
    paramKey?: string;
    method?: string;
    next?: string;
}

export interface SapFlow {
    steps: {
        [key: string]: SapFlowStep;
    };
}

// Tipos de acciones disponibles en el flujo SAP
export type SapActionType = 'click' | 'set' | 'callProgram' | 'callSubflow' | 'exit';

// Función para convertir el flujo SAP a nuestro modelo de flujo visual
export function convertSapFlowToVisualFlow(sapFlow: any, name: string): Flow {
    const flow: Flow = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2),
        name,
        nodes: [],
        connections: []
    };
    
    // Posiciones iniciales para la disposición automática
    let x = 100;
    let y = 100;
    const yOffset = 120;
    const xOffset = 200;
    
    // Función para detectar si un objeto es un container (tiene sub-pasos)
    function isContainer(obj: any): boolean {
        if (!obj || typeof obj !== 'object') return false;
        
        return Object.keys(obj).some(key => 
            typeof obj[key] === 'object' && 
            obj[key] !== null && 
            obj[key].action
        );
    }
    
    // Procesar el flujo - puede tener estructura 'steps' o ser directo
    const stepsData = sapFlow.steps || sapFlow;
    
    // Crear nodos para cada paso
    Object.entries(stepsData).forEach(([stepId, stepData], index) => {
        let nodeType: 'action' | 'decision' | 'subflow' = 'action';
        let nodeData: any = {};
        
        // Si es un container con sub-pasos
        if (isContainer(stepData)) {
            nodeType = 'subflow';
            nodeData = stepData; // Guardar toda la estructura del container
        } else {
            // Es un paso simple
            const step = stepData as SapFlowStep;
            
            if (step.action === 'callSubflow') {
                nodeType = 'subflow';
            } else if (step.action === 'exit') {
                nodeType = 'action';
            }
            
            nodeData = {
                action: step.action,
                target: step.target,
                paramKey: step.paramKey,
                method: step.method,
                timeout: (step as any).timeout,
                operator: (step as any).operator,
                next: step.next
            };
        }
        
        // Crear el nodo
        const node: FlowNode = {
            id: stepId,
            type: nodeType,
            label: stepId,
            x: x,
            y: y + (index * yOffset),
            data: nodeData
        };
        
        flow.nodes.push(node);
        
        // Crear conexión si hay un siguiente paso
        if (!isContainer(stepData)) {
            const step = stepData as SapFlowStep;
            if (step.next) {
                const connection: Connection = {
                    id: `${stepId}-${step.next}`,
                    sourceId: stepId,
                    targetId: step.next,
                    label: ''
                };
                
                flow.connections.push(connection);
            }
        } else {
            // Para containers, buscar conexiones en los sub-pasos
            const containerData = stepData as any;
            Object.values(containerData).forEach((subStep: any) => {
                if (subStep && subStep.next && typeof subStep.next === 'string') {
                    const connection: Connection = {
                        id: `${stepId}-${subStep.next}`,
                        sourceId: stepId,
                        targetId: subStep.next,
                        label: ''
                    };
                    
                    flow.connections.push(connection);
                }
            });
        }
    });
    
    // Organizar los nodos en un layout más visual
    arrangeNodesInLayout(flow);
    
    return flow;
}

// Función para organizar los nodos en un layout visual
function arrangeNodesInLayout(flow: Flow): void {
    // Implementación básica de layout en niveles
    const levels: { [key: string]: number } = {};
    const visited: Set<string> = new Set();
    
    // Encontrar nodos iniciales (sin conexiones entrantes)
    const startNodes = flow.nodes.filter(node => 
        !flow.connections.some(conn => conn.targetId === node.id)
    );
    
    // Asignar niveles a los nodos
    function assignLevels(nodeId: string, level: number) {
        if (visited.has(nodeId)) return;
        
        visited.add(nodeId);
        levels[nodeId] = Math.max(level, levels[nodeId] || 0);
        
        // Encontrar conexiones salientes
        const outConnections = flow.connections.filter(conn => conn.sourceId === nodeId);
        for (const conn of outConnections) {
            assignLevels(conn.targetId, level + 1);
        }
    }
    
    // Asignar niveles comenzando desde los nodos iniciales
    startNodes.forEach(node => assignLevels(node.id, 0));
    
    // Posicionar nodos según su nivel
    const levelWidth = 250;
    const nodeHeight = 100;
    const nodesPerLevel: { [key: number]: number } = {};
    
    // Contar nodos por nivel
    Object.entries(levels).forEach(([nodeId, level]) => {
        nodesPerLevel[level] = (nodesPerLevel[level] || 0) + 1;
    });
    
    // Posicionar nodos
    Object.entries(levels).forEach(([nodeId, level]) => {
        const node = flow.nodes.find(n => n.id === nodeId);
        if (node) {
            // Calcular posición X basada en el nivel
            node.x = 100 + (level * levelWidth);
            
            // Calcular posición Y distribuida en el nivel
            const nodesInLevel = nodesPerLevel[level];
            const nodeIndex = flow.nodes
                .filter(n => levels[n.id] === level)
                .findIndex(n => n.id === nodeId);
            
            node.y = 100 + (nodeIndex * nodeHeight);
        }
    });
} 