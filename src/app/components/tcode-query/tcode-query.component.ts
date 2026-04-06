import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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
  fromYear = this.currentYear - 1;
  toYear = this.currentYear;
  useSpecificDateRange = false;
  fromDate = '';
  toDate = '';
  submitted = false;

  onDateModeChange(): void {
    if (!this.useSpecificDateRange) {
      this.fromDate = '';
      this.toDate = '';
    }
  }

  submit(): void {
    this.submitted = true;
  }
}
