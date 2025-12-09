import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export interface SapTarget {
  Id: string;
  ControlType: string;
  FriendlyName: string;
  FriendlyGroup: string;
  group?: string;
}

export interface SapTargetFile {
  name: string;
  tcode: string;
  path: string;
  size: number;
  modified: Date;
}

export interface SapTargetData {
  Tcode: string;
  Generated: string;
  TargetControls: {
    [groupName: string]: SapTarget[];
  };
}

export interface TargetControlsResponse {
  success: boolean;
  tcode: string;
  controlsByType: { [controlType: string]: SapTarget[] };
  controlsByGroup: { [groupName: string]: SapTarget[] };
  summary: {
    totalGroups: number;
    totalControls: number;
    controlTypes: string[];
  };
}

@Injectable({
  providedIn: 'root'
})
export class TargetsService {
  private baseUrl = 'http://localhost:3000/api';
  private availableTargetsSubject = new BehaviorSubject<SapTargetFile[]>([]);
  private currentTargetsSubject = new BehaviorSubject<TargetControlsResponse | null>(null);

  constructor(private http: HttpClient) {}

  // Observables públicos
  getAvailableTargets(): Observable<SapTargetFile[]> {
    return this.availableTargetsSubject.asObservable();
  }

  getCurrentTargets(): Observable<TargetControlsResponse | null> {
    return this.currentTargetsSubject.asObservable();
  }

  // Cargar lista de archivos targets disponibles
  loadAvailableTargets(): Observable<SapTargetFile[]> {
    return this.http.get<{success: boolean, targets: SapTargetFile[]}>(`${this.baseUrl}/targets`)
      .pipe(
        map(response => {
          if (response.success) {
            this.availableTargetsSubject.next(response.targets);
            return response.targets;
          }
          return [];
        }),
        catchError(error => {
          console.error('Error al cargar targets disponibles:', error);
          return of([]);
        })
      );
  }

  // Cargar targets para un tcode específico
  loadTargetsForTcode(tcode: string): Observable<TargetControlsResponse | null> {
    const url = `${this.baseUrl}/targets/${tcode}/controls`;
    console.log('Llamando a URL:', url);
    
    return this.http.get<TargetControlsResponse>(url)
      .pipe(
        map(response => {
          console.log('Respuesta del servidor:', response);
          if (response.success) {
            this.currentTargetsSubject.next(response);
            return response;
          }
          return null;
        }),
        catchError(error => {
          console.error(`Error al cargar targets para ${tcode}:`, error);
          this.currentTargetsSubject.next(null);
          return of(null);
        })
      );
  }

  // Obtener datos completos de targets para un tcode
  getTargetData(tcode: string): Observable<SapTargetData | null> {
    return this.http.get<{success: boolean, tcode: string, targets: SapTargetData}>(`${this.baseUrl}/targets/${tcode}`)
      .pipe(
        map(response => {
          if (response.success) {
            return response.targets;
          }
          return null;
        }),
        catchError(error => {
          console.error(`Error al obtener datos de targets para ${tcode}:`, error);
          return of(null);
        })
      );
  }

  // Buscar targets por nombre o ID
  searchTargets(query: string, targets: TargetControlsResponse): SapTarget[] {
    if (!query || !targets) return [];
    
    const searchTerm = query.toLowerCase();
    const allTargets: SapTarget[] = [];
    
    // Recopilar todos los targets
    Object.values(targets.controlsByGroup).forEach(group => {
      allTargets.push(...group);
    });
    
    // Filtrar por término de búsqueda
    return allTargets.filter(target => 
      target.FriendlyName.toLowerCase().includes(searchTerm) ||
      target.Id.toLowerCase().includes(searchTerm) ||
      target.ControlType.toLowerCase().includes(searchTerm) ||
      target.FriendlyGroup.toLowerCase().includes(searchTerm)
    );
  }

  // Filtrar targets por tipo de control
  filterTargetsByType(controlTypes: string[], targets: TargetControlsResponse): SapTarget[] {
    if (!controlTypes.length || !targets) return [];
    
    const filteredTargets: SapTarget[] = [];
    
    controlTypes.forEach(type => {
      if (targets.controlsByType[type]) {
        filteredTargets.push(...targets.controlsByType[type]);
      }
    });
    
    return filteredTargets;
  }

  // Validar si un target existe
  validateTarget(targetId: string, targets: TargetControlsResponse): boolean {
    if (!targets) return false;
    
    return Object.values(targets.controlsByGroup).some(group =>
      group.some(target => target.Id === targetId)
    );
  }

  // Obtener sugerencias de targets basadas en el tipo de acción
  getSuggestedTargets(actionType: string, targets: TargetControlsResponse): SapTarget[] {
    if (!targets) return [];
    
    // Mapear tipos de acción a tipos de control sugeridos
    const actionToControlTypeMap: { [key: string]: string[] } = {
      'click': ['GuiButton', 'GuiMenu', 'GuiMenuItem'],
      'set': ['GuiTextField', 'GuiCTextField', 'GuiCheckBox', 'GuiRadioButton'],
      'select': ['GuiComboBox', 'GuiListBox', 'GuiTable'],
      'waitFor': ['GuiModalWindow', 'GuiMainWindow', 'GuiUserArea']
    };
    
    const suggestedTypes = actionToControlTypeMap[actionType] || [];
    const suggestedTargets: SapTarget[] = [];
    
    suggestedTypes.forEach(type => {
      if (targets.controlsByType[type]) {
        suggestedTargets.push(...targets.controlsByType[type]);
      }
    });
    
    return suggestedTargets;
  }

  // Limpiar el estado actual
  clearCurrentTargets(): void {
    this.currentTargetsSubject.next(null);
  }
} 