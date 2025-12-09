import { Component, OnInit, Input, Output, EventEmitter, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TargetsService, SapTarget, TargetControlsResponse } from '../../services/targets.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-target-selector',
  templateUrl: './target-selector.component.html',
  styleUrls: ['./target-selector.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class TargetSelectorComponent implements OnInit, OnDestroy, OnChanges {
  @Input() tcode: string = '';
  @Input() actionType: string = '';
  @Input() selectedTargetId: string = '';
  @Output() targetSelected = new EventEmitter<SapTarget>();
  @Output() targetValidated = new EventEmitter<boolean>();

  targets: TargetControlsResponse | null = null;
  filteredTargets: SapTarget[] = [];
  searchTerm: string = '';
  selectedControlTypes: string[] = [];
  availableControlTypes: string[] = [];
  
  // Estado de la UI
  isLoading: boolean = false;
  error: string | null = null;
  showSuggestions: boolean = true;
  showAllTargets: boolean = false;
  
  // Configuración de visualización
  groupBy: 'type' | 'group' = 'type';
  showTargetDetails: boolean = false;
  
  private subscriptions: Subscription[] = [];

  constructor(private targetsService: TargetsService) {}

  ngOnInit(): void {
    console.log('TargetSelectorComponent inicializado con tcode:', this.tcode);
    
    // Suscribirse a cambios en los targets actuales
    this.subscriptions.push(
      this.targetsService.getCurrentTargets().subscribe(targets => {
        console.log('Targets recibidos:', targets);
        this.targets = targets;
        this.updateAvailableControlTypes();
        this.updateFilteredTargets();
      })
    );

    // Cargar targets si se proporciona un tcode
    if (this.tcode) {
      this.loadTargets();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    console.log('TargetSelectorComponent cambios detectados:', changes);
    
    // Si cambia el tcode, recargar targets
    if (changes['tcode'] && changes['tcode'].currentValue) {
      console.log('Tcode cambió a:', changes['tcode'].currentValue);
      this.loadTargets();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  // Cargar targets para el tcode actual
  loadTargets(): void {
    if (!this.tcode) return;
    
    console.log('Cargando targets para tcode:', this.tcode);
    this.isLoading = true;
    this.error = null;
    
    this.targetsService.loadTargetsForTcode(this.tcode).subscribe({
      next: (targets) => {
        console.log('Targets cargados exitosamente:', targets);
        this.isLoading = false;
        if (!targets) {
          this.error = `No se encontraron targets para ${this.tcode}`;
        }
      },
      error: (error) => {
        console.error('Error al cargar targets:', error);
        this.isLoading = false;
        this.error = `Error al cargar targets: ${error.message}`;
      }
    });
  }

  // Actualizar tipos de control disponibles
  updateAvailableControlTypes(): void {
    if (this.targets) {
      this.availableControlTypes = this.targets.summary.controlTypes;
    }
  }

  // Actualizar targets filtrados
  updateFilteredTargets(): void {
    if (!this.targets) {
      this.filteredTargets = [];
      return;
    }

    let targets: SapTarget[] = [];

    if (this.showSuggestions && this.actionType) {
      // Mostrar sugerencias basadas en el tipo de acción
      targets = this.targetsService.getSuggestedTargets(this.actionType, this.targets);
    } else if (this.selectedControlTypes.length > 0) {
      // Filtrar por tipos de control seleccionados
      targets = this.targetsService.filterTargetsByType(this.selectedControlTypes, this.targets);
    } else {
      // Mostrar todos los targets
      Object.values(this.targets.controlsByGroup).forEach(group => {
        targets.push(...group);
      });
    }

    // Aplicar filtro de búsqueda
    if (this.searchTerm) {
      targets = this.targetsService.searchTargets(this.searchTerm, this.targets);
    }

    this.filteredTargets = targets;
  }

  // Manejar búsqueda
  onSearch(): void {
    this.updateFilteredTargets();
  }

  // Manejar selección de tipo de control
  onControlTypeToggle(controlType: string): void {
    const index = this.selectedControlTypes.indexOf(controlType);
    if (index > -1) {
      this.selectedControlTypes.splice(index, 1);
    } else {
      this.selectedControlTypes.push(controlType);
    }
    this.updateFilteredTargets();
  }

  // Verificar si un tipo de control está seleccionado
  isControlTypeSelected(controlType: string): boolean {
    return this.selectedControlTypes.includes(controlType);
  }

  // Seleccionar un target
  selectTarget(target: SapTarget): void {
    this.selectedTargetId = target.Id;
    this.targetSelected.emit(target);
    this.validateCurrentTarget();
  }

  // Validar el target actual
  validateCurrentTarget(): void {
    if (!this.targets) {
      this.targetValidated.emit(false);
      return;
    }

    const isValid = this.targetsService.validateTarget(this.selectedTargetId, this.targets);
    this.targetValidated.emit(isValid);
  }

  // Obtener targets agrupados por tipo
  getTargetsByType(): { [type: string]: SapTarget[] } {
    if (!this.targets) return {};
    
    const grouped: { [type: string]: SapTarget[] } = {};
    
    this.filteredTargets.forEach(target => {
      if (!grouped[target.ControlType]) {
        grouped[target.ControlType] = [];
      }
      grouped[target.ControlType].push(target);
    });
    
    return grouped;
  }

  // Obtener las claves de los targets agrupados por tipo
  getTargetTypeKeys(): string[] {
    return Object.keys(this.getTargetsByType());
  }

  // Obtener targets agrupados por grupo
  getTargetsByGroup(): { [group: string]: SapTarget[] } {
    if (!this.targets) return {};
    
    const grouped: { [group: string]: SapTarget[] } = {};
    
    this.filteredTargets.forEach(target => {
      const group = target.FriendlyGroup || 'Sin grupo';
      if (!grouped[group]) {
        grouped[group] = [];
      }
      grouped[group].push(target);
    });
    
    return grouped;
  }

  // Obtener las claves de los targets agrupados por grupo
  getTargetGroupKeys(): string[] {
    return Object.keys(this.getTargetsByGroup());
  }

  // Alternar modo de sugerencias
  toggleSuggestions(): void {
    this.showSuggestions = !this.showSuggestions;
    this.updateFilteredTargets();
  }

  // Alternar mostrar todos los targets
  toggleShowAllTargets(): void {
    this.showAllTargets = !this.showAllTargets;
    if (this.showAllTargets) {
      this.showSuggestions = false;
    }
    this.updateFilteredTargets();
  }

  // Cambiar modo de agrupación
  toggleGroupBy(): void {
    this.groupBy = this.groupBy === 'type' ? 'group' : 'type';
  }

  // Limpiar filtros
  clearFilters(): void {
    this.searchTerm = '';
    this.selectedControlTypes = [];
    this.showSuggestions = true;
    this.showAllTargets = false;
    this.updateFilteredTargets();
  }

  // Obtener icono para tipo de control
  getControlTypeIcon(controlType: string): string {
    const iconMap: { [key: string]: string } = {
      'GuiButton': 'bi-cursor',
      'GuiTextField': 'bi-input-cursor-text',
      'GuiCTextField': 'bi-input-cursor',
      'GuiCheckBox': 'bi-check-square',
      'GuiRadioButton': 'bi-circle',
      'GuiComboBox': 'bi-menu-button-wide',
      'GuiListBox': 'bi-list-ul',
      'GuiTable': 'bi-table',
      'GuiModalWindow': 'bi-window',
      'GuiMainWindow': 'bi-window-fullscreen',
      'GuiUserArea': 'bi-layout-text-window',
      'GuiToolbar': 'bi-tools',
      'GuiStatusbar': 'bi-info-circle',
      'GuiMenu': 'bi-list',
      'GuiMenuItem': 'bi-menu-app'
    };
    
    return iconMap[controlType] || 'bi-square';
  }

  // Obtener color para tipo de control
  getControlTypeColor(controlType: string): string {
    const colorMap: { [key: string]: string } = {
      'GuiButton': 'primary',
      'GuiTextField': 'success',
      'GuiCTextField': 'success',
      'GuiCheckBox': 'info',
      'GuiRadioButton': 'info',
      'GuiComboBox': 'warning',
      'GuiListBox': 'warning',
      'GuiTable': 'danger',
      'GuiModalWindow': 'secondary',
      'GuiMainWindow': 'secondary',
      'GuiUserArea': 'light',
      'GuiToolbar': 'dark',
      'GuiStatusbar': 'dark'
    };
    
    return colorMap[controlType] || 'secondary';
  }
} 