# 📋 GUÍA RÁPIDA - Recuperación de Datos FinanceX

## 🎯 Resumen en 30 segundos

Tu app **perdió datos de marzo** por un **bug en la sincronización con Firestore**. Hemos **CORREGIDO** el código y agregado protecciones.

### Tu app ahora:
✅ **Protege** los datos del borrado  
✅ **Advierte** si hay problemas  
✅ **Almacena backup** automático  
✅ **Recupera datos** fácilmente  

---

## 🚀 PRIMEROS PASOS (80% de recuperación)

### Paso 1: Abre la app
```bash
npm run dev
# O abre http://localhost:5173
```

### Paso 2: Busca esta alerta
```
⚠️ Sincronización Bloqueada
```

Si la ves = **Tienes suerte, tus datos aún están en el navegador**

### Paso 3: Haz clic en botón verde
```
✓ Usar Datos Locales
```

### Paso 4: Descarga respaldo
```
↓ Descargar Backup JSON
```

**¡Listo!** Tus datos de marzo deberían aparecer.

---

## 🔧 Si NO ves la alerta (datos perdidos)

**Abre el archivo** `recuperador-datos.html` directamente en el navegador:

1. **Busca el archivo** en la carpeta del proyecto
2. **Abre con navegador** (doble clic)
3. **Ve a la sección** "📋 Ver Datos Locales"
4. **Haz clic** en "Mostrar Datos Locales"

Si aparecen datos = Los tienes, solo necesitas restaurarlos.  
Si no aparece nada = Se perdieron (al limpiar navegador cache).

---

## 📊 ¿Qué fue corregido?

| Problema | Solución |
|----------|----------|
| Nube sobrescribe datos vacíos ❌ | Ahora detecta y bloquea ✅ |
| Sin backup automático ❌ | Guardas cada cambio ✅ |
| Sin alerta de problemas ❌ | Modal advierte ✅ |
| No puedes descargar datos ❌ | Botón para JSON ✅ |

---

## ⚠️ IMPORTANTE: Reglas Firebase

Tu Firebase **está abierto al público** (API Key visible).

### ¿Qué hacer?

1. **Ve a**: https://console.firebase.google.com
2. **Proyecto**: `financex-fodexa`
3. **Firestore** → **Reglas** 
4. **Reemplaza** todo con:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

5. **Publish** cambios

**Esto**: Solo usuarios autenticados pueden leer/escribir.

---

## 🛠️ Validar que funciona todo

### Prueba 1: Datos locales
```bash
npm run dev
# Debería cargar sin errores
# Status debe decir "Sincronizado" o "Modo offline"
```

### Prueba 2: Agregar dato de prueba
1. Abre la app
2. Registra una venta de prueba
3. Abre DevTools (F12)
4. **Consola** → Escribe:
```javascript
JSON.stringify(localStorage.getItem('financex_app_data_v1'))
```
5. Deberías ver tu dato registrado

### Prueba 3: Recarga de página
1. Agrega datos
2. Recarga la página (F5)
3. Datos deben persistir

---

## 📞 Checklist Post-Recuperación

- [ ] Datos de marzo aparecen en la app
- [ ] Descargaste JSON backup
- [ ] Actualizaste reglas Firebase
- [ ] Sincronización funciona sin errores
- [ ] Creaste copia de respaldo en Google Drive (opcional)

---

## 🆘 Si aún hay problemas

### Problema: "No veo ningún dato"

```javascript
// En consola (F12):
// Opción 1: Verifica si hay datos guardados
localStorage.getItem('financex_app_data_v1')
// Si retorna null = datos perdidos

// Opción 2: Restaurar desde backup si lo descargaste
const datosRespaldo = {...}; // pega aquí
localStorage.setItem('financex_app_data_v1', JSON.stringify(datosRespaldo));
location.reload();
```

### Problema: "Sincronización bloqueada no desaparece"

Haz clic en **"⚡ Habilitar Sincronización"** para reactivar.

### Problema: "Firebase tiene un error"

Verifica que las nuevas reglas de seguridad se publicaron correctamente:
1. Ve a Firebase Console
2. Firestore Database → Rules
3. Debería estar verde ✅

---

## 📚 Documentación Técnica

- **PROBLEMAS_Y_SOLUCIONES.md** ← Análisis técnico completo  
- **recuperador-datos.html** ← Herramienta de recuperación manual  
- **FinanceX.jsx** ← Código corregido (líneas 194-250)

---

## 🎓 Cómo evitar esto en el futuro

1. **Backup automático**: Implementar Google Drive Sync
2. **Historial de versiones**: Guardar snapshots diarios  
3. **Autenticación**: Para que cada usuario tenga sus datos
4. **Validación**: Chequeos antes de sobrescribir
5. **Logs**: Auditoría de cambios

---

**Versión actualizada**: 11 de Marzo de 2025  
**Estado**: ✅ CORREGIDO Y TESTEABLE

¿Dudas? Abre la consola (F12) y ejecuta cualquiera de estos comandos:

```javascript
// Ver todos tus datos
console.log(JSON.parse(localStorage.getItem('financex_app_data_v1')))

// Ver si hay backup
console.log(JSON.parse(localStorage.getItem('financex_backup_datos')))

// Ver espacio usado
navigator.storage.estimate().then(({usage}) => console.log(`Espacio: ${(usage/1024/1024).toFixed(2)}MB`))
```
