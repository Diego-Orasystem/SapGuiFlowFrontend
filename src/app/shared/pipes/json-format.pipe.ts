import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'jsonFormat',
  standalone: true
})
export class JsonFormatPipe implements PipeTransform {
  transform(value: any): string {
    if (!value) {
      return '';
    }
    
    try {
      // Si es un string JSON, intentar parsearlo primero
      if (typeof value === 'string') {
        value = JSON.parse(value);
      }
      
      // Formatear el objeto JSON con indentación
      return JSON.stringify(value, null, 2);
    } catch (e) {
      // Si hay un error (ej: no es un JSON válido), devolver el valor original
      return String(value);
    }
  }
} 