// plano-canvas.js — motor de dibujo sobre el plano. Sin dependencias,
// canvas 2D nativo. No hace reconocimiento de imagen: el usuario marca
// todo a mano (escala, ambientes, canalizaciones), lo cual mantiene esto
// 100% cliente, sin costo, sin conexión.
//
// Toda la geometría (rooms, canalizaciones, calibración) se guarda en
// "espacio imagen" = los píxeles crudos del canvas interno, SIN importar
// el zoom/paneo actual. El zoom es sólo una transformación de vista que
// se aplica al dibujar y al interpretar los toques — así el área/largo
// calculados no cambian nunca por hacer zoom.

const MAX_DIM = 1400; // resolución interna máxima del canvas, para performance
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

const ROOM_COLOR = 'rgba(245, 166, 35, 0.22)';
const ROOM_STROKE = '#a86a12';
const ROOM_STROKE_ACTIVE = '#f5a623';
const CALIB_COLOR = '#d33d3d';

export const COLORES_CANALIZACION = [
  { id: 'amber', hex: '#f5a623', nombre: 'Ámbar' },
  { id: 'blue', hex: '#3b82f6', nombre: 'Azul' },
  { id: 'green', hex: '#1f9d63', nombre: 'Verde' },
  { id: 'red', hex: '#d33d3d', nombre: 'Rojo' },
  { id: 'purple', hex: '#8b5cf6', nombre: 'Violeta' },
  { id: 'teal', hex: '#0d9488', nombre: 'Turquesa' },
];

export class PlanoCanvas {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = callbacks; // { onRoomClosed, onCalibration, onChange }

    this.image = null;
    this.imageDataUrl = null;
    this.pixelsPerMeter = null;

    this.mode = 'ver'; // 'calibrar' | 'ambiente' | 'canalizacion' | 'ver'
    this.currentColor = COLORES_CANALIZACION[0].hex;
    this.tipoAmbienteActivo = 'otro'; // tipo que se asigna al ambiente que se está por cerrar

    this.rooms = [];          // { id, points:[{x,y}], tipoAmbienteId, nombre, areaM2 }
    this.canalizaciones = []; // { id, points:[{x,y}], color, largoM }

    this.view = { zoom: 1, panX: 0, panY: 0 };

    this._calibPoints = [];
    this._activeRoomPoints = [];
    this._activeCurvePoints = [];

    this._pointers = new Map();  // pointerId -> {x,y} en espacio raster
    this._downInfo = null;       // { id, start, moved } del toque en curso (para diferenciar tap de drag)
    this._dragStart = null;      // paneo con 1 dedo en modo 'ver'
    this._pinchStart = null;     // pellizco con 2 dedos (zoom)

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('pointercancel', this._onPointerUp);
    canvas.addEventListener('pointerleave', this._onPointerUp);
  }

  setImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.image = img;
        this.imageDataUrl = dataUrl;
        let w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, MAX_DIM / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        this.canvas.width = w;
        this.canvas.height = h;
        this.view = { zoom: 1, panX: 0, panY: 0 };
        this.redraw();
        resolve();
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  setMode(mode) {
    this.mode = mode;
    this._calibPoints = [];
    this._activeRoomPoints = [];
    this._activeCurvePoints = [];
    this.redraw();
  }

  setCurrentColor(hex) { this.currentColor = hex; }
  setTipoAmbienteActivo(tipoId) { this.tipoAmbienteActivo = tipoId; }

  setPixelsPerMeter(v) {
    this.pixelsPerMeter = v;
    this._recomputeAreas();
    this.redraw();
    this._change();
  }

  hasScale() { return !!this.pixelsPerMeter; }

  // --- Zoom / paneo ---
  zoomBy(factor, rasterCenter) {
    const center = rasterCenter || { x: this.canvas.width / 2, y: this.canvas.height / 2 };
    const imgCenter = this._toImageSpace(center);
    const newZoom = clamp(this.view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.view.zoom = newZoom;
    this.view.panX = imgCenter.x - center.x / newZoom;
    this.view.panY = imgCenter.y - center.y / newZoom;
    this._clampPan();
    this.redraw();
  }
  resetView() { this.view = { zoom: 1, panX: 0, panY: 0 }; this.redraw(); }
  zoomPercent() { return Math.round(this.view.zoom * 100); }

  _clampPan() {
    if (!this.canvas.width) return;
    const w = this.canvas.width, h = this.canvas.height, z = this.view.zoom;
    const maxPanX = Math.max(0, w - w / z);
    const maxPanY = Math.max(0, h - h / z);
    this.view.panX = Math.min(Math.max(this.view.panX, 0), maxPanX);
    this.view.panY = Math.min(Math.max(this.view.panY, 0), maxPanY);
  }

  // --- Coordenadas ---
  // Evento de puntero -> píxeles internos del canvas (espacio "raster", sin zoom aplicado)
  _eventToRasterPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }
  // Punto raster (según la vista actual, con zoom/paneo) -> espacio imagen real
  _toImageSpace(rasterPoint) {
    return {
      x: rasterPoint.x / this.view.zoom + this.view.panX,
      y: rasterPoint.y / this.view.zoom + this.view.panY,
    };
  }
  // Radio de "toque cerca de" en espacio imagen, calibrado para sentirse igual
  // de generoso en la pantalla sin importar el tamaño de la foto o el zoom.
  _hitRadiusImageSpace() {
    const rect = this.canvas.getBoundingClientRect();
    const rasterPerCss = this.canvas.width / (rect.width || this.canvas.width);
    const desiredCssPx = 24;
    return (desiredCssPx * rasterPerCss) / this.view.zoom;
  }

  // --- Punteros (toques/mouse): tap para dibujar, 1 dedo para panear (modo Ver),
  // 2 dedos para pellizcar-zoom en cualquier modo ---
  _onPointerDown(e) {
    if (!this.image) return;
    this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
    const p = this._eventToRasterPoint(e);
    this._pointers.set(e.pointerId, p);

    if (this._pointers.size === 1) {
      this._downInfo = { id: e.pointerId, start: p, moved: false };
      if (this.mode === 'ver') {
        this._dragStart = { x: p.x, y: p.y, panX0: this.view.panX, panY0: this.view.panY };
      }
    } else if (this._pointers.size === 2) {
      this._downInfo = null;
      const pts = [...this._pointers.values()];
      this._pinchStart = { d: dist(pts[0], pts[1]) || 1, mid: midpoint(pts[0], pts[1]), zoom0: this.view.zoom, imgMid: this._toImageSpace(midpoint(pts[0], pts[1])) };
    }
  }

  _onPointerMove(e) {
    if (!this._pointers.has(e.pointerId)) return;
    const p = this._eventToRasterPoint(e);
    this._pointers.set(e.pointerId, p);

    if (this._downInfo && this._downInfo.id === e.pointerId && dist(p, this._downInfo.start) > 6) {
      this._downInfo.moved = true;
    }

    if (this._pointers.size >= 2 && this._pinchStart) {
      const pts = [...this._pointers.values()].slice(0, 2);
      const newD = dist(pts[0], pts[1]) || 1;
      const newMid = midpoint(pts[0], pts[1]);
      const newZoom = clamp(this._pinchStart.zoom0 * (newD / this._pinchStart.d), MIN_ZOOM, MAX_ZOOM);
      this.view.zoom = newZoom;
      this.view.panX = this._pinchStart.imgMid.x - newMid.x / newZoom;
      this.view.panY = this._pinchStart.imgMid.y - newMid.y / newZoom;
      this._clampPan();
      this.redraw();
      this.cb.onZoomChange && this.cb.onZoomChange(this.zoomPercent());
    } else if (this._pointers.size === 1 && this.mode === 'ver' && this._dragStart) {
      const dxRaster = p.x - this._dragStart.x;
      const dyRaster = p.y - this._dragStart.y;
      this.view.panX = this._dragStart.panX0 - dxRaster / this.view.zoom;
      this.view.panY = this._dragStart.panY0 - dyRaster / this.view.zoom;
      this._clampPan();
      this.redraw();
    }
  }

  _onPointerUp(e) {
    if (!this._pointers.has(e.pointerId)) { this._pointers.delete(e.pointerId); return; }
    const wasThisDown = this._downInfo && this._downInfo.id === e.pointerId;
    const tapStart = wasThisDown ? this._downInfo.start : null;
    const wasTap = wasThisDown && !this._downInfo.moved;
    this._pointers.delete(e.pointerId);
    if (wasThisDown) this._downInfo = null;
    if (this._pointers.size < 2) this._pinchStart = null;
    if (this._pointers.size === 0) this._dragStart = null;

    if (wasTap && tapStart) this._handleTap(this._toImageSpace(tapStart));
  }

  _handleTap(pImg) {
    if (this.mode === 'calibrar') {
      this._calibPoints.push(pImg);
      this.redraw();
      if (this._calibPoints.length === 2) {
        const dImg = dist(this._calibPoints[0], this._calibPoints[1]);
        this.cb.onCalibration && this.cb.onCalibration(dImg, () => { this._calibPoints = []; this.redraw(); });
      }
      return;
    }
    if (this.mode === 'ambiente') {
      if (this._activeRoomPoints.length >= 3 && dist(pImg, this._activeRoomPoints[0]) < this._hitRadiusImageSpace()) {
        this._closeRoom();
        return;
      }
      this._activeRoomPoints.push(pImg);
      this.redraw();
      return;
    }
    if (this.mode === 'canalizacion') {
      this._activeCurvePoints.push(pImg);
      this.redraw();
      return;
    }
  }

  // Llamado desde un botón "Cerrar ambiente" por si el usuario no puede
  // tocar exacto el primer punto (dedos grandes, plano chico, sin zoom).
  closeActiveRoom() { if (this._activeRoomPoints.length >= 3) this._closeRoom(); }

  _closeRoom() {
    const points = this._activeRoomPoints.slice();
    this._activeRoomPoints = [];
    const room = {
      id: uid(),
      points,
      tipoAmbienteId: this.tipoAmbienteActivo || 'otro',
      nombre: '',
      areaM2: this.pixelsPerMeter ? areaOfPolygon(points) / (this.pixelsPerMeter ** 2) : 0,
    };
    this.rooms.push(room);
    this.redraw();
    this._change();
    this.cb.onRoomClosed && this.cb.onRoomClosed(room);
  }

  finishActiveCurve() {
    if (this._activeCurvePoints.length < 2) { this._activeCurvePoints = []; this.redraw(); return; }
    const points = this._activeCurvePoints.slice();
    this._activeCurvePoints = [];
    let lenPx = 0;
    for (let i = 1; i < points.length; i++) lenPx += dist(points[i - 1], points[i]);
    const canal = {
      id: uid(),
      points,
      color: this.currentColor,
      largoM: this.pixelsPerMeter ? lenPx / this.pixelsPerMeter : 0,
    };
    this.canalizaciones.push(canal);
    this.redraw();
    this._change();
  }

  undoLastPoint() {
    if (this.mode === 'ambiente' && this._activeRoomPoints.length) this._activeRoomPoints.pop();
    else if (this.mode === 'canalizacion' && this._activeCurvePoints.length) this._activeCurvePoints.pop();
    this.redraw();
  }

  deleteRoom(id) { this.rooms = this.rooms.filter(r => r.id !== id); this.redraw(); this._change(); }
  deleteCanalizacion(id) { this.canalizaciones = this.canalizaciones.filter(c => c.id !== id); this.redraw(); this._change(); }
  updateRoom(id, patch) {
    const r = this.rooms.find(r => r.id === id);
    if (!r) return;
    Object.assign(r, patch);
    this.redraw();
    this._change();
  }

  _recomputeAreas() {
    if (!this.pixelsPerMeter) return;
    for (const r of this.rooms) r.areaM2 = areaOfPolygon(r.points) / (this.pixelsPerMeter ** 2);
    for (const c of this.canalizaciones) {
      let lenPx = 0;
      for (let i = 1; i < c.points.length; i++) lenPx += dist(c.points[i - 1], c.points[i]);
      c.largoM = lenPx / this.pixelsPerMeter;
    }
  }

  _change() { this.cb.onChange && this.cb.onChange(this); }

  // --- Render ---
  redraw() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const z = this.view.zoom;
    ctx.setTransform(z, 0, 0, z, -this.view.panX * z, -this.view.panY * z);

    if (this.image) ctx.drawImage(this.image, 0, 0, width, height);

    for (const r of this.rooms) {
      this._drawPolygon(r.points, ROOM_COLOR, ROOM_STROKE, true);
      const c = centroid(r.points);
      if (r.nombre) {
        ctx.font = `${Math.max(11, width * 0.011)}px sans-serif`;
        ctx.fillStyle = '#182233';
        ctx.textAlign = 'center';
        ctx.fillText(r.nombre, c.x, c.y);
        if (r.areaM2) {
          ctx.font = `${Math.max(10, width * 0.009)}px sans-serif`;
          ctx.fillStyle = '#5c6675';
          ctx.fillText(`${r.areaM2.toFixed(1)} m²`, c.x, c.y + 15);
        }
      }
    }
    if (this._activeRoomPoints.length) {
      this._drawPolygon(this._activeRoomPoints, 'rgba(245,166,35,0.12)', ROOM_STROKE_ACTIVE, false);
      this._drawPoints(this._activeRoomPoints, ROOM_STROKE_ACTIVE);
    }

    for (const c of this.canalizaciones) this._drawCurve(c.points, c.color, 3 / z);
    if (this._activeCurvePoints.length) this._drawCurve(this._activeCurvePoints, this.currentColor, 3 / z, true);

    if (this._calibPoints.length) {
      ctx.strokeStyle = CALIB_COLOR;
      ctx.lineWidth = 2.5 / z;
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.beginPath();
      ctx.moveTo(this._calibPoints[0].x, this._calibPoints[0].y);
      if (this._calibPoints[1]) ctx.lineTo(this._calibPoints[1].x, this._calibPoints[1].y);
      ctx.stroke();
      ctx.setLineDash([]);
      this._drawPoints(this._calibPoints, CALIB_COLOR);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  _drawPolygon(points, fill, stroke, close) {
    if (points.length < 2) { this._drawPoints(points, stroke); return; }
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    if (close) ctx.closePath();
    if (close) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2 / this.view.zoom;
    ctx.stroke();
    this._drawPoints(points, stroke);
  }

  _drawPoints(points, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    const r = 4 / this.view.zoom;
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawCurve(points, color, width, dashed) {
    if (points.length < 2) { if (points.length === 1) this._drawPoints(points, color); return; }
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dashed) ctx.setLineDash([8 / this.view.zoom, 5 / this.view.zoom]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
      ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
    }
    if (points.length > 1) ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
    ctx.setLineDash([]);
    this._drawPoints([points[0], points[points.length - 1]], color);
  }

  // --- Persistencia ---
  serialize() {
    return {
      imageDataUrl: this.imageDataUrl,
      pixelsPerMeter: this.pixelsPerMeter,
      rooms: this.rooms,
      canalizaciones: this.canalizaciones,
    };
  }

  async loadFromData(data) {
    if (data.imageDataUrl) await this.setImage(data.imageDataUrl);
    this.pixelsPerMeter = data.pixelsPerMeter || null;
    this.rooms = data.rooms || [];
    this.canalizaciones = data.canalizaciones || [];
    this.redraw();
  }

  snapshotDataUrl() {
    // Postal siempre a zoom 1 completo (para que el PDF muestre el plano entero).
    const tmp = document.createElement('canvas');
    tmp.width = this.canvas.width; tmp.height = this.canvas.height;
    const tctx = tmp.getContext('2d');
    const savedView = this.view;
    this.view = { zoom: 1, panX: 0, panY: 0 };
    const savedCtx = this.ctx, savedCanvas = this.canvas;
    this.ctx = tctx; this.canvas = tmp;
    this.redraw();
    this.ctx = savedCtx; this.canvas = savedCanvas;
    this.view = savedView;
    return tmp.toDataURL('image/jpeg', 0.85);
  }

  superficieTotalM2() { return this.rooms.reduce((s, r) => s + (r.areaM2 || 0), 0); }
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

function areaOfPolygon(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i], p2 = points[(i + 1) % points.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a / 2);
}

function centroid(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

function uid() { return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`; }
