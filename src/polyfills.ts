/**
 * Este archivo incluye polyfills necesarios para aplicaciones Angular y se carga antes de la app.
 * También puedes agregar tus propios polyfills extra.
 *
 * Este archivo se divide en 2 secciones:
 *   1. Polyfills del navegador. Estos se aplican antes de cargar ZoneJS y son ordenados por navegadores.
 *   2. Importaciones de aplicación. Archivos importados después de ZoneJS que deberían ser cargados antes de tu app.
 *
 * La configuración actual es para los llamados navegadores "evergreen";
 * las últimas versiones de navegadores que se actualizan automáticamente.
 */

/***************************************************************************************************
 * BROWSER POLYFILLS
 */

/**
 * Por defecto, zone.js corregirá todas las posibles macrotareas, pero esto puede provocar 
 * problemas de rendimiento con algunas macrotareas como <object> o <embed>. 
 * Aprende más sobre estas opciones en https://github.com/angular/angular/blob/master/packages/zone.js/ENVIRONMENT_VARIABLES.md
 */
// (window as any).__Zone_disable_requestAnimationFrame = true; // desactiva patch requestAnimationFrame
// (window as any).__Zone_disable_on_property = true; // desactiva patch onProperty como onclick
// (window as any).__zone_symbol__UNPATCHED_EVENTS = ['scroll', 'mousemove']; // desactiva patch eventos especificados

/**
 * Zone JS es requerido por Angular.
 */
import 'zone.js';  // Incluido con Angular CLI.

/***************************************************************************************************
 * APPLICATION IMPORTS
 */ 