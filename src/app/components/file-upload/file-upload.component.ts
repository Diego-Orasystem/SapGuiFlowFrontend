import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FileService } from '../../services/file.service';
import { FlowService } from '../../services/flow.service';

@Component({
  selector: 'app-file-upload',
  templateUrl: './file-upload.component.html',
  styleUrls: ['./file-upload.component.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class FileUploadComponent implements OnInit {
  isDragging = false;
  selectedFile: File | null = null;
  fileInfo: { size: string; date: string } | null = null;
  uploadError: string | null = null;
  isLoading = false;
  demoDataLoaded = false;

  constructor(private fileService: FileService, private flowService: FlowService) { }

  ngOnInit(): void {
    this.fileService.getInputFile().subscribe(file => {
      this.selectedFile = file;
      this.updateFileInfo();
    });
    
    // Suscribirse a cambios en el archivo seleccionado para procesar automáticamente
    this.fileService.getSelectedFile().subscribe(file => {
      if (file && file.content) {
        try {
          // Intentar importar el archivo como un flujo SAP
          this.flowService.importSapFlow(file.content, file.name);
        } catch (error) {
          console.error('Error al importar el flujo:', error);
        }
      }
    });
  }

  /**
   * Carga datos de prueba precargados
   */
  loadDemoData(): void {
    this.isLoading = true;
    this.uploadError = null;
    
    this.fileService.loadDemoData().subscribe({
      next: (files) => {
        this.isLoading = false;
        this.demoDataLoaded = true;
        console.log('Datos de prueba cargados:', files);
        
        // Limpiamos el archivo seleccionado para evitar confusión
        this.selectedFile = null;
        this.fileInfo = null;
        
        // Si hay archivos, seleccionamos el primero para procesarlo automáticamente
        if (files && files.length > 0) {
          this.fileService.setSelectedFile(files[0]);
        }
        
        // Automáticamente después de 5 segundos ocultamos el mensaje
        setTimeout(() => {
          this.demoDataLoaded = false;
        }, 5000);
      },
      error: (error) => {
        this.isLoading = false;
        this.uploadError = 'Error al cargar datos de prueba: ' + error.message;
        console.error('Error loading demo data:', error);
      }
    });
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
    
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFileSelection(files[0]);
    }
  }

  onFileSelected(event: Event): void {
    const element = event.target as HTMLInputElement;
    const files = element.files;
    
    if (files && files.length > 0) {
      this.handleFileSelection(files[0]);
    }
  }

  handleFileSelection(file: File): void {
    // Verificar si es un archivo ZIP
    if (!file.name.toLowerCase().endsWith('.zip')) {
      this.uploadError = 'Por favor, seleccione un archivo ZIP';
      return;
    }
    
    this.selectedFile = file;
    this.fileService.setInputFile(file);
    this.updateFileInfo();
    this.uploadError = null;
    
    // Cargar el archivo automáticamente
    this.uploadFile();
  }

  updateFileInfo(): void {
    if (this.selectedFile) {
      // Formatear tamaño del archivo
      const size = this.formatFileSize(this.selectedFile.size);
      
      // Formatear fecha de modificación
      const date = new Date().toLocaleDateString();
      
      this.fileInfo = { size, date };
    } else {
      this.fileInfo = null;
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  uploadFile(): void {
    if (!this.selectedFile) {
      this.uploadError = 'Por favor, seleccione un archivo primero';
      return;
    }
    
    this.isLoading = true;
    this.uploadError = null;
    
    this.fileService.uploadZipFile(this.selectedFile).subscribe({
      next: (files) => {
        this.isLoading = false;
        console.log('Archivos cargados:', files);
        
        // Si hay archivos, seleccionamos el primero para procesarlo automáticamente
        if (files && files.length > 0) {
          this.fileService.setSelectedFile(files[0]);
        }
      },
      error: (error) => {
        this.isLoading = false;
        this.uploadError = 'Error al cargar el archivo: ' + error.message;
        console.error('Error uploading file:', error);
      }
    });
  }
} 