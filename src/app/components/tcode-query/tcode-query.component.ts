import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface GeneratedSqprFile {
  year: number;
  fileName: string;
  content: string;
  postingDateLow: string;
  postingDateHigh: string;
}

@Component({
  selector: 'app-tcode-query',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tcode-query.component.html',
  styleUrls: ['./tcode-query.component.scss']
})
export class TcodeQueryComponent {
  currentYear = new Date().getFullYear();
  selectedTcode = 'mb51';
  fromYear = this.currentYear - 4;
  toYear = this.currentYear;
  useSpecificDateRange = false;
  fromDate = '';
  toDate = '';

  generatedFiles: GeneratedSqprFile[] = [];
  formError = '';

  readonly availableTcodes = [
    { value: 'mb51', label: 'MB51', enabled: true },
    { value: 'me2l', label: 'ME2L (proximamente)', enabled: false }
  ];

  private readonly mb51BaseTemplate = {
    tcode: 'MB51',
    'Plant Low': '2000',
    'Plant High': '2200',
    Columns: ['All'],
    NoSum: ['All']
  };

  onDateModeChange(): void {
    this.generatedFiles = [];
    this.formError = '';

    if (!this.useSpecificDateRange) {
      this.fromDate = '';
      this.toDate = '';
    }
  }

  generate(): void {
    this.formError = '';
    this.generatedFiles = [];

    if (this.selectedTcode !== 'mb51') {
      this.formError = 'Por ahora solo esta habilitado MB51.';
      return;
    }

    if (!this.useSpecificDateRange) {
      this.generateFromYears();
      return;
    }

    this.generateFromSpecificRange();
  }

  downloadFile(file: GeneratedSqprFile): void {
    const blob = new Blob([file.content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  downloadAllFiles(): void {
    for (const file of this.generatedFiles) {
      this.downloadFile(file);
    }
  }

  get totalYearsGenerated(): number {
    return this.generatedFiles.length;
  }

  private generateFromYears(): void {
    const startYear = Number(this.fromYear);
    const endYear = Number(this.toYear);

    if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
      this.formError = 'Los anos deben ser valores enteros.';
      return;
    }

    if (startYear > endYear) {
      this.formError = 'El ano inicial no puede ser mayor al ano final.';
      return;
    }

    const totalYears = endYear - startYear + 1;
    if (totalYears > 20) {
      this.formError = 'Por UX y performance, el maximo permitido por ejecucion es 20 anos.';
      return;
    }

    const files: GeneratedSqprFile[] = [];

    for (let year = startYear; year <= endYear; year++) {
      const start = `${year}-01-01`;
      const end = `${year}-12-31`;
      files.push(this.buildMb51File(year, start, end));
    }

    this.generatedFiles = files;
  }

  private generateFromSpecificRange(): void {
    if (!this.fromDate || !this.toDate) {
      this.formError = 'Debes indicar fecha inicial y fecha final.';
      return;
    }

    if (this.fromDate > this.toDate) {
      this.formError = 'La fecha inicial no puede ser mayor a la fecha final.';
      return;
    }

    const startYear = new Date(`${this.fromDate}T00:00:00`).getFullYear();
    const endYear = new Date(`${this.toDate}T00:00:00`).getFullYear();

    const files: GeneratedSqprFile[] = [];
    for (let year = startYear; year <= endYear; year++) {
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const start = year === startYear ? this.fromDate : yearStart;
      const end = year === endYear ? this.toDate : yearEnd;
      files.push(this.buildMb51File(year, start, end));
    }

    this.generatedFiles = files;
  }

  private buildMb51File(year: number, isoLow: string, isoHigh: string): GeneratedSqprFile {
    const postingDateLow = this.formatToSapDate(isoLow);
    const postingDateHigh = this.formatToSapDate(isoHigh);
    const pdl = isoLow;
    const pdh = isoHigh;
    const startDate = this.formatToSapDate(this.addDaysIso(isoHigh, 1));

    const payload = {
      ...this.mb51BaseTemplate,
      'Posting date LOW': postingDateLow,
      'Posting date HIGH': postingDateHigh
    };

    const timestamp = new Date().toISOString();
    const fileName = `${this.generateHexId()}-MB51@startDate=${startDate}@PDL=${pdl}@PDH=${pdh}--dwld-${timestamp}.sqpr`;

    return {
      year,
      fileName,
      postingDateLow,
      postingDateHigh,
      content: `${JSON.stringify(payload, null, 2)}\n`
    };
  }

  private formatToSapDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-');
    return `${day}.${month}.${year}`;
  }

  private addDaysIso(isoDate: string, days: number): string {
    const date = new Date(`${isoDate}T00:00:00`);
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private generateHexId(): string {
    let value = '';
    const chars = 'ABCDEF0123456789';
    for (let i = 0; i < 8; i++) {
      value += chars[Math.floor(Math.random() * chars.length)];
    }
    return value;
  }
}
