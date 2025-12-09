import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FlowEditorComponent } from '../flow-editor/flow-editor.component';
import { FilePreviewComponent } from '../file-preview/file-preview.component';
import { ExportToolsComponent } from '../export-tools/export-tools.component';
import { FileService } from '../../services/file.service';
import { FlowService } from '../../services/flow.service';
import { SftpService, SftpFile } from '../../services/sftp.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FlowEditorComponent, 
    FilePreviewComponent, 
    ExportToolsComponent
  ]
})
export class HomeComponent implements OnInit {
  sapFlowJson = '';
  isFileSelectorSectionOpen = true;
  availableFlows: SftpFile[] = [];
  loadingFlows = false;
  selectedFlow: SftpFile | null = null;
  
  constructor(
    private fileService: FileService, 
    private flowService: FlowService,
    private sftpService: SftpService
  ) {}
  
  ngOnInit(): void {
    this.loadFlowsFromSftp();
  }
  
  toggleFileSelectorSection(): void {
    this.isFileSelectorSectionOpen = !this.isFileSelectorSectionOpen;
  }

  /**
   * Carga la lista de flujos desde el servidor SFTP
   */
  loadFlowsFromSftp(): void {
    this.loadingFlows = true;
    this.availableFlows = [];

    this.sftpService.listFlows().subscribe({
      next: (response) => {
        this.loadingFlows = false;
        if (response.status && response.files) {
          this.availableFlows = response.files.filter(file => 
            !file.isDirectory && (file.name.endsWith('.json') || file.name.endsWith('.zip'))
          );
        } else {
          console.error('Error al cargar flujos:', response.message);
        }
      },
      error: (error) => {
        this.loadingFlows = false;
        console.error('Error al cargar flujos desde SFTP:', error);
      }
    });
  }

  /**
   * Selecciona y carga un flujo desde SFTP
   */
  selectFlow(flow: SftpFile): void {
    this.selectedFlow = flow;
    this.loadingFlows = true;

    this.sftpService.getJsonFileContent(flow.path).subscribe({
      next: (response) => {
        this.loadingFlows = false;
        if (response.status && response.content) {
          try {
            // Actualizar el JSON para el editor
            this.sapFlowJson = response.content;
            
            // Cargar el flujo en el editor
            this.flowService.importSapFlow(response.content, flow.name);
            
            // Notificar al FileService
            this.fileService.setSelectedFile({
              name: flow.name,
              path: flow.path,
              content: response.content,
              size: flow.size,
              modified: new Date(flow.modifiedDate)
            });
          } catch (error) {
            console.error('Error al procesar el flujo:', error);
          }
        } else {
          console.error('Error al cargar el flujo:', response.message);
        }
      },
      error: (error) => {
        this.loadingFlows = false;
        console.error('Error al cargar flujo desde SFTP:', error);
      }
    });
  }

  /**
   * Formatea el tamaño del archivo
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Formatea la fecha
   */
  formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  }

  /**
   * Crea un flujo en blanco con la estructura básica
   */
  createBlankFlow(): void {
    const blankFlow = {
      "$meta": {
        "tcode": "",
        "description": "Flujo nuevo"
      },
      "targetContext": {},
      "steps": {}
    };

    const flowName = `Nuevo_Flujo_${new Date().toISOString().replace(/[:.]/g, '-').split('T')[0]}`;
    const flowFileName = `${flowName}.json`;
    
    // Convertir a JSON formateado
    this.sapFlowJson = JSON.stringify(blankFlow, null, 2);
    
    // Cargar el flujo en el editor
    this.flowService.importSapFlow(this.sapFlowJson, flowFileName);
    
    // Notificar al FileService
    this.fileService.setSelectedFile({
      name: flowFileName,
      path: '',
      content: this.sapFlowJson,
      size: this.sapFlowJson.length,
      modified: new Date()
    });

    // Limpiar selección de flujo SFTP
    this.selectedFlow = null;
  }
}

