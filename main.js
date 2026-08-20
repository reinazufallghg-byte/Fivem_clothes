import { fabric } from 'fabric';

const MAX_HISTORY = 60;

export function createEditor({ canvasElId, stageElId, onChange, onSelectionChange, onObjectsChange }) {
  const canvas = new fabric.Canvas(canvasElId, {
    backgroundColor: '#ffffff',
    preserveObjectStacking: true,
    selection: true,
    stopContextMenu: true,
  });

  const stageEl = document.getElementById(stageElId);

  let resolution = 1024;
  let zoomLevel = 1;
  let history = [];
  let historyIndex = -1;
  let lockHistory = false;
  let nameCounters = { Text: 0, Bild: 0, Rechteck: 0, Kreis: 0, Dreieck: 0, Linie: 0, Pfad: 0 };
  let rafPending = false;

  canvas.setWidth(resolution);
  canvas.setHeight(resolution);

  // ---------- change notification (drives live 3D sync + history) ----------

  function notifyVisualChange() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      onChange && onChange(canvas.getElement());
    });
  }

  canvas.on('after:render', notifyVisualChange);

  function saveState() {
    if (lockHistory) return;
    const json = JSON.stringify(canvas.toJSON(['customName', 'selectable', 'evented']));
    history = history.slice(0, historyIndex + 1);
    history.push(json);
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
    refreshLayers();
  }

  function restoreState(index) {
    if (index < 0 || index >= history.length) return;
    lockHistory = true;
    canvas.loadFromJSON(history[index], () => {
      canvas.renderAll();
      lockHistory = false;
      historyIndex = index;
      refreshLayers();
      notifyVisualChange();
    });
  }

  canvas.on('object:added', saveState);
  canvas.on('object:removed', saveState);
  canvas.on('object:modified', saveState);
  canvas.on('selection:created', emitSelection);
  canvas.on('selection:updated', emitSelection);
  canvas.on('selection:cleared', emitSelection);
  canvas.on('object:added', () => onObjectsChange && onObjectsChange(canvas.getObjects()));
  canvas.on('object:removed', () => onObjectsChange && onObjectsChange(canvas.getObjects()));

  function emitSelection() {
    const active = canvas.getActiveObject();
    onSelectionChange && onSelectionChange(active || null);
  }

  function refreshLayers() {
    onObjectsChange && onObjectsChange(canvas.getObjects());
  }

  // ---------- naming ----------

  function nextName(base) {
    nameCounters[base] = (nameCounters[base] || 0) + 1;
    return `${base} ${nameCounters[base]}`;
  }

  // ---------- tools ----------

  let activeTool = 'select';
  let brushColor = '#c9703c';
  let brushWidth = 10;

  function setTool(tool) {
    activeTool = tool;
    canvas.isDrawingMode = tool === 'draw';
    canvas.selection = tool === 'select';
    canvas.forEachObject((o) => (o.selectable = tool === 'select'));
    if (tool === 'draw') {
      if (!canvas.freeDrawingBrush) canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = brushColor;
      canvas.freeDrawingBrush.width = brushWidth;
    }
    canvas.requestRenderAll();
  }

  function setBrushColor(hex) {
    brushColor = hex;
    if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = hex;
    const active = canvas.getActiveObject();
    if (active && activeTool === 'select') {
      if ('fill' in active) active.set('fill', hex);
      canvas.requestRenderAll();
      saveState();
    }
  }

  function setBrushWidth(px) {
    brushWidth = px;
    if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.width = px;
  }

  function addText() {
    const t = new fabric.IText('Text', {
      left: canvas.getWidth() / 2,
      top: canvas.getHeight() / 2,
      originX: 'center',
      originY: 'center',
      fill: brushColor,
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: Math.max(24, Math.round(canvas.getWidth() / 16)),
      customName: nextName('Text'),
    });
    canvas.add(t);
    canvas.setActiveObject(t);
    setTool('select');
  }

  function addShape(kind) {
    const w = canvas.getWidth();
    const h = canvas.getHeight();
    const common = {
      left: w / 2,
      top: h / 2,
      originX: 'center',
      originY: 'center',
      fill: brushColor,
      stroke: '#00000055',
      strokeWidth: 0,
    };
    let shape;
    if (kind === 'rect') {
      shape = new fabric.Rect({ ...common, width: w * 0.3, height: h * 0.3, customName: nextName('Rechteck') });
    } else if (kind === 'circle') {
      shape = new fabric.Circle({ ...common, radius: w * 0.15, customName: nextName('Kreis') });
    } else if (kind === 'triangle') {
      shape = new fabric.Triangle({ ...common, width: w * 0.3, height: h * 0.3, customName: nextName('Dreieck') });
    } else if (kind === 'line') {
      shape = new fabric.Line([w * 0.35, h * 0.5, w * 0.65, h * 0.5], {
        stroke: brushColor,
        strokeWidth: Math.max(4, brushWidth / 2),
        customName: nextName('Linie'),
      });
    }
    if (shape) {
      canvas.add(shape);
      canvas.setActiveObject(shape);
      setTool('select');
    }
  }

  function insertImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      fabric.Image.fromURL(e.target.result, (img) => {
        const maxDim = canvas.getWidth() * 0.5;
        if (img.width > maxDim) img.scaleToWidth(maxDim);
        img.set({
          left: canvas.getWidth() / 2,
          top: canvas.getHeight() / 2,
          originX: 'center',
          originY: 'center',
          customName: nextName('Bild'),
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        setTool('select');
      });
    };
    reader.readAsDataURL(file);
  }

  // ---------- filters (applied to selected image objects) ----------

  function makeFilter(key) {
    switch (key) {
      case 'grayscale':
        return new fabric.Image.filters.Grayscale();
      case 'sepia':
        return new fabric.Image.filters.Sepia();
      case 'invert':
        return new fabric.Image.filters.Invert();
      case 'blur':
        return new fabric.Image.filters.Blur({ blur: 0.18 });
      default:
        return null;
    }
  }

  function toggleFilter(key) {
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'image') return false;
    if (!active.filters) active.filters = [];
    const idx = active.filters.findIndex((f) => f.__key === key);
    let nowOn;
    if (idx > -1) {
      active.filters.splice(idx, 1);
      nowOn = false;
    } else {
      const f = makeFilter(key);
      if (!f) return false;
      f.__key = key;
      active.filters.push(f);
      nowOn = true;
    }
    active.applyFilters();
    canvas.requestRenderAll();
    saveState();
    return nowOn;
  }

  function getActiveFilterKeys() {
    const active = canvas.getActiveObject();
    if (!active || !active.filters) return [];
    return active.filters.map((f) => f.__key).filter(Boolean);
  }

  // ---------- layers ----------

  function selectObject(obj) {
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
  }

  function deleteObject(obj) {
    canvas.remove(obj);
  }

  function toggleVisibility(obj) {
    obj.visible = !obj.visible;
    canvas.requestRenderAll();
    saveState();
  }

  function getLayers() {
    return canvas.getObjects().slice().reverse();
  }

  // ---------- undo / redo ----------

  function undo() {
    if (historyIndex <= 0) return;
    restoreState(historyIndex - 1);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    restoreState(historyIndex + 1);
  }

  // ---------- zoom / fit (CSS-only scaling, backstore stays at texture resolution) ----------

  function applyZoom(z) {
    zoomLevel = Math.min(4, Math.max(0.08, z));
    const cssSize = Math.round(resolution * zoomLevel);
    canvas.setDimensions({ width: cssSize, height: cssSize }, { cssOnly: true });
    return zoomLevel;
  }

  function fitToStage() {
    if (!stageEl) return applyZoom(1);
    const pad = 48;
    const availW = stageEl.clientWidth - pad;
    const availH = stageEl.clientHeight - pad;
    const z = Math.max(0.05, Math.min(availW / resolution, availH / resolution));
    return applyZoom(z);
  }

  function zoomBy(delta) {
    return applyZoom(zoomLevel + delta);
  }

  // ---------- canvas lifecycle: new / load base texture ----------

  function resetHistory() {
    history = [];
    historyIndex = -1;
    saveState();
  }

  function newCanvas(res) {
    resolution = res;
    canvas.clear();
    canvas.setBackgroundColor('#ffffff', () => {});
    canvas.setWidth(resolution);
    canvas.setHeight(resolution);
    fitToStage();
    resetHistory();
    canvas.requestRenderAll();
    notifyVisualChange();
  }

  function loadBaseTextureFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      fabric.Image.fromURL(e.target.result, (img) => {
        resolution = img.width;
        canvas.clear();
        canvas.setWidth(img.width);
        canvas.setHeight(img.height);
        img.set({ left: 0, top: 0, selectable: false, evented: false });
        canvas.setBackgroundImage(img, () => {
          canvas.requestRenderAll();
          fitToStage();
          resetHistory();
          notifyVisualChange();
        });
      });
    };
    reader.readAsDataURL(file);
  }

  function exportPNG() {
    const dataUrl = canvas.toDataURL({ format: 'png', enableRetinaScaling: false });
    return dataUrl;
  }

  function getResolution() {
    return resolution;
  }

  function getZoom() {
    return zoomLevel;
  }

  // ---------- keyboard shortcuts ----------

  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (canvas.getActiveObject() && canvas.getActiveObject().isEditing) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = canvas.getActiveObject();
      if (active) {
        e.preventDefault();
        canvas.remove(active);
      }
    } else if (e.key.toLowerCase() === 'v') {
      setTool('select');
    } else if (e.key.toLowerCase() === 'b') {
      setTool('draw');
    } else if (e.key.toLowerCase() === 't') {
      addText();
    }
  });

  // ---------- ctrl/cmd + wheel zoom on stage ----------

  if (stageEl) {
    stageEl.addEventListener(
      'wheel',
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const dir = e.deltaY > 0 ? -1 : 1;
        applyZoom(zoomLevel + dir * zoomLevel * 0.12);
        window.dispatchEvent(new CustomEvent('editor:zoom', { detail: zoomLevel }));
      },
      { passive: false }
    );
  }

  window.addEventListener('resize', () => {
    // keep current zoom on manual resize; user can press "Fit" to re-center
  });

  saveState();

  return {
    canvas,
    setTool,
    setBrushColor,
    setBrushWidth,
    addText,
    addShape,
    insertImageFile,
    toggleFilter,
    getActiveFilterKeys,
    selectObject,
    deleteObject,
    toggleVisibility,
    getLayers,
    undo,
    redo,
    applyZoom,
    fitToStage,
    zoomBy,
    newCanvas,
    loadBaseTextureFile,
    exportPNG,
    getResolution,
    getZoom,
  };
}