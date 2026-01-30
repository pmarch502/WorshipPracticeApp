/**
 * Knob Component
 * A rotary knob control using SVG
 */

export class Knob {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            min: options.min ?? 0,
            max: options.max ?? 100,
            value: options.value ?? 50,
            step: options.step ?? 1,
            startAngle: options.startAngle ?? -135,
            endAngle: options.endAngle ?? 135,
            size: options.size ?? 40,
            onChange: options.onChange ?? (() => {}),
            formatValue: options.formatValue ?? ((v) => v.toString()),
            bipolar: options.bipolar ?? false, // For pan-style knobs where center is 0
            defaultValue: options.defaultValue ?? null, // Value to reset to on double-click (null = auto)
        };

        this.value = this.options.value;
        this.isDragging = false;
        this.startY = 0;
        this.startValue = 0;

        this.render();
        this.attachEvents();
    }

    render() {
        const size = this.options.size;
        const center = size / 2;
        const radius = (size / 2) - 4;
        const innerRadius = radius - 6;

        // Calculate indicator line positions
        // For size 28 (pan knobs): y1=16, y2=8 as specified
        // For other sizes: scale proportionally
        let indicatorY1, indicatorY2;
        if (size === 28) {
            indicatorY1 = 16;
            indicatorY2 = 8;
        } else {
            // Scale proportionally: 16/28 and 8/28 of size
            indicatorY1 = Math.round(size * 16 / 28);
            indicatorY2 = Math.round(size * 8 / 28);
        }

        this.container.innerHTML = `
            <div class="knob" style="width: ${size}px; height: ${size}px;">
                <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
                    <!-- Track (background arc) -->
                    <path class="knob-track" d="${this.describeArc(center, center, radius, this.options.startAngle, this.options.endAngle)}"/>
                    <!-- Fill (value arc) -->
                    <path class="knob-fill" d="${this.getValueArc()}"/>
                    <!-- Center circle -->
                    <circle class="knob-center" cx="${center}" cy="${center}" r="${innerRadius}"/>
                    <!-- Indicator line - drawn pointing upward from center -->
                    <line class="knob-indicator" 
                          x1="${center}" 
                          y1="${indicatorY1}" 
                          x2="${center}" 
                          y2="${indicatorY2}"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          transform="rotate(${this.valueToAngle(this.value)}, ${center}, ${center})"/>
                </svg>
            </div>
        `;

        this.element = this.container.querySelector('.knob');
        this.fillPath = this.container.querySelector('.knob-fill');
        this.indicator = this.container.querySelector('.knob-indicator');
    }

    describeArc(x, y, radius, startAngle, endAngle) {
        const start = this.polarToCartesian(x, y, radius, endAngle);
        const end = this.polarToCartesian(x, y, radius, startAngle);
        const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

        return [
            'M', start.x, start.y,
            'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y
        ].join(' ');
    }

    polarToCartesian(centerX, centerY, radius, angleInDegrees) {
        const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
        return {
            x: centerX + (radius * Math.cos(angleInRadians)),
            y: centerY + (radius * Math.sin(angleInRadians))
        };
    }

    valueToAngle(value) {
        const range = this.options.max - this.options.min;
        const normalized = (value - this.options.min) / range;
        const angle = this.options.startAngle + normalized * (this.options.endAngle - this.options.startAngle);
        return angle;
    }

    angleToValue(angle) {
        const range = this.options.endAngle - this.options.startAngle;
        const normalized = (angle - this.options.startAngle) / range;
        return this.options.min + normalized * (this.options.max - this.options.min);
    }

    getValueArc() {
        const size = this.options.size;
        const center = size / 2;
        const radius = (size / 2) - 4;
        
        if (this.options.bipolar) {
            // For bipolar knobs, draw from center (0 point) to current value
            const zeroAngle = this.valueToAngle(0);
            const valueAngle = this.valueToAngle(this.value);
            
            if (Math.abs(this.value) < 0.01) {
                return ''; // No arc when at center
            }
            
            const startAngle = this.value > 0 ? zeroAngle : valueAngle;
            const endAngle = this.value > 0 ? valueAngle : zeroAngle;
            
            return this.describeArc(center, center, radius, startAngle, endAngle);
        } else {
            // Standard unipolar knob
            const valueAngle = this.valueToAngle(this.value);
            return this.describeArc(center, center, radius, this.options.startAngle, valueAngle);
        }
    }

    updateVisual() {
        const size = this.options.size;
        const center = size / 2;
        const innerRadius = (size / 2) - 10;
        
        // Update fill arc
        this.fillPath.setAttribute('d', this.getValueArc());
        
        // Update indicator rotation
        const angle = this.valueToAngle(this.value);
        this.indicator.setAttribute('transform', `rotate(${angle}, ${center}, ${center})`);
    }

    setValue(value, triggerChange = true) {
        const oldValue = this.value;
        this.value = Math.max(this.options.min, Math.min(this.options.max, value));
        
        // Snap to step
        this.value = Math.round(this.value / this.options.step) * this.options.step;
        
        // Fix floating point precision
        this.value = parseFloat(this.value.toFixed(10));
        
        this.updateVisual();
        
        if (triggerChange && oldValue !== this.value) {
            this.options.onChange(this.value);
        }
    }

    getValue() {
        return this.value;
    }

    attachEvents() {
        const onMouseDown = (e) => {
            e.preventDefault();
            this.isDragging = true;
            this.startY = e.clientY;
            this.startValue = this.value;
            this.element.style.cursor = 'ns-resize';
            document.body.style.cursor = 'ns-resize';
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            if (!this.isDragging) return;
            
            const deltaY = this.startY - e.clientY;
            const range = this.options.max - this.options.min;
            // 300 pixels for full range (was 100) - much more precise control
            const sensitivity = range / 300;
            
            let newValue = this.startValue + deltaY * sensitivity;
            
            // Shift key for even finer control (10x more precise)
            if (e.shiftKey) {
                newValue = this.startValue + deltaY * sensitivity * 0.1;
            }
            
            this.setValue(newValue);
        };

        const onMouseUp = () => {
            this.isDragging = false;
            this.element.style.cursor = 'pointer';
            document.body.style.cursor = '';
            
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        // Mouse events
        this.element.addEventListener('mousedown', onMouseDown);

        // Double-click to reset
        this.element.addEventListener('dblclick', () => {
            if (this.options.defaultValue !== null) {
                // Use custom default value if specified
                this.setValue(this.options.defaultValue);
            } else if (this.options.bipolar) {
                this.setValue(0);
            } else {
                this.setValue((this.options.max + this.options.min) / 2);
            }
        });

        // Mouse wheel
        this.element.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -this.options.step : this.options.step;
            const multiplier = e.shiftKey ? 0.1 : 1;
            this.setValue(this.value + delta * multiplier);
        });

        // Touch events
        this.element.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.isDragging = true;
            this.startY = touch.clientY;
            this.startValue = this.value;
        });

        this.element.addEventListener('touchmove', (e) => {
            if (!this.isDragging) return;
            e.preventDefault();
            
            const touch = e.touches[0];
            const deltaY = this.startY - touch.clientY;
            const range = this.options.max - this.options.min;
            // 300 pixels for full range (was 100) - much more precise control
            const sensitivity = range / 300;
            
            const newValue = this.startValue + deltaY * sensitivity;
            this.setValue(newValue);
        });

        this.element.addEventListener('touchend', () => {
            this.isDragging = false;
        });
    }

    destroy() {
        this.container.innerHTML = '';
    }
}

// Factory function for creating knobs with common presets
export function createVolumeKnob(container, onChange) {
    return new Knob(container, {
        min: 0,
        max: 100,
        value: 80,
        step: 1,
        onChange
    });
}

export function createPanKnob(container, onChange) {
    return new Knob(container, {
        min: -100,
        max: 100,
        value: 0,
        step: 1,
        size: 28,
        bipolar: true,
        onChange
    });
}
