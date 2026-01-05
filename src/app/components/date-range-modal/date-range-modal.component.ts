import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface DateRange {
  startDate: string;
  endDate: string;
  periodType: 'month' | 'day';
}

@Component({
  selector: 'app-date-range-modal',
  templateUrl: './date-range-modal.component.html',
  styleUrls: ['./date-range-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class DateRangeModalComponent implements OnInit {
  @Input() show: boolean = false;
  @Input() periodType: 'month' | 'day' | 'both' = 'both';
  @Input() title: string = 'Seleccionar Período';
  @Output() close = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<DateRange>();

  selectedPeriodType: 'month' | 'day' = 'month';
  selectedMonth: string = '';
  selectedYear: string = '';
  startDate: string = '';
  endDate: string = '';

  ngOnInit(): void {
    // Inicializar con valores por defecto
    const today = new Date();
    this.selectedYear = today.getFullYear().toString();
    this.selectedMonth = (today.getMonth() + 1).toString().padStart(2, '0');
    
    // Si solo permite meses, establecer el tipo
    if (this.periodType === 'month') {
      this.selectedPeriodType = 'month';
    } else if (this.periodType === 'day') {
      this.selectedPeriodType = 'day';
    }
  }

  getMonthOptions(): string[] {
    return ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  }

  getYearOptions(): string[] {
    const currentYear = new Date().getFullYear();
    const years: string[] = [];
    for (let i = currentYear - 5; i <= currentYear + 1; i++) {
      years.push(i.toString());
    }
    return years;
  }

  onClose(): void {
    this.close.emit();
  }

  onConfirm(): void {
    let dateRange: DateRange;

    if (this.selectedPeriodType === 'month') {
      // Para meses, usar el primer y último día del mes
      const year = parseInt(this.selectedYear);
      const month = parseInt(this.selectedMonth);
      const firstDay = new Date(year, month - 1, 1);
      const lastDay = new Date(year, month, 0);
      
      dateRange = {
        startDate: this.formatDate(firstDay),
        endDate: this.formatDate(lastDay),
        periodType: 'month'
      };
    } else {
      // Para días, usar el rango seleccionado
      if (!this.startDate || !this.endDate) {
        alert('Por favor seleccione un rango de fechas');
        return;
      }
      
      dateRange = {
        startDate: this.startDate,
        endDate: this.endDate,
        periodType: 'day'
      };
    }

    this.confirm.emit(dateRange);
  }

  getMonthName(month: string): string {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    return months[parseInt(month) - 1];
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

