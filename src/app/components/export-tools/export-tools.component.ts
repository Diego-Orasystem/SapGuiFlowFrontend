import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FileService } from '../../services/file.service';
import { FlowFile } from '../../models/flow-file.model';

@Component({
  selector: 'app-export-tools',
  templateUrl: './export-tools.component.html',
  styleUrls: ['./export-tools.component.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class ExportToolsComponent implements OnInit {
  outputFiles: FlowFile[] = [];
  isExporting = false;
  isVerifying = false;
  verificationResult: { valid: boolean, errors: string[] } | null = null;
  
  constructor(private fileService: FileService) { }

  ngOnInit(): void {
    this.fileService.getOutputFiles().subscribe(files => {
      this.outputFiles = files;
    });
  }

  exportAllFiles(): void {
    if (this.outputFiles.length === 0) {
      console.warn('No hay archivos para exportar');
      return;
    }
    
    this.isExporting = true;
    
    this.fileService.exportFiles(this.outputFiles).subscribe({
      next: (blob) => {
        this.fileService.downloadZip(blob, 'sap-gui-flow-export.zip');
        this.isExporting = false;
      },
      error: (error) => {
        console.error('Error al exportar archivos', error);
        this.isExporting = false;
      }
    });
  }
  
  // Método para exportar un archivo individual
  exportSingleFile(file: FlowFile): void {
    this.fileService.exportSingleFile(file);
  }
  
  // Método para verificar la integridad de los flujos
  verifyFlowIntegrity(): void {
    if (this.outputFiles.length === 0) {
      console.warn('No hay archivos para verificar');
      return;
    }
    
    this.isVerifying = true;
    this.verificationResult = this.fileService.verifyFlowIntegrity(this.outputFiles);
    this.isVerifying = false;
  }
  
  // Método para limpiar los resultados de verificación
  clearVerificationResults(): void {
    this.verificationResult = null;
  }
} 