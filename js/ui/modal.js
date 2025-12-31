/**
 * Modal Component
 * Handles confirmation dialogs and other modal interactions
 */

class ModalManager {
    constructor() {
        this.overlay = document.getElementById('modal-overlay');
        this.dialog = document.getElementById('modal-dialog');
        this.titleEl = document.getElementById('modal-title');
        this.contentEl = document.getElementById('modal-content');
        this.cancelBtn = document.getElementById('modal-cancel');
        this.confirmBtn = document.getElementById('modal-confirm');
        this.closeBtn = document.getElementById('modal-close');
        
        this.currentResolve = null;
        this.currentReject = null;
        
        this.attachEvents();
    }

    attachEvents() {
        this.closeBtn.addEventListener('click', () => this.close(false));
        this.cancelBtn.addEventListener('click', () => this.close(false));
        this.confirmBtn.addEventListener('click', () => this.close(true));
        
        // Close on overlay click
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close(false);
            }
        });
        
        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.overlay.classList.contains('hidden')) {
                this.close(false);
            }
        });
    }

    /**
     * Show a confirmation dialog
     * @param {Object} options - Dialog options
     * @param {string} options.title - Dialog title
     * @param {string} options.message - Dialog message (can be HTML)
     * @param {string} options.confirmText - Text for confirm button
     * @param {string} options.cancelText - Text for cancel button
     * @param {string} options.confirmClass - CSS class for confirm button
     * @returns {Promise<boolean>} - Resolves to true if confirmed, false if cancelled
     */
    confirm(options = {}) {
        const {
            title = 'Confirm',
            message = 'Are you sure?',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            confirmClass = 'btn-primary'
        } = options;

        return new Promise((resolve) => {
            this.currentResolve = resolve;
            
            this.titleEl.textContent = title;
            this.contentEl.innerHTML = message;
            this.confirmBtn.textContent = confirmText;
            this.cancelBtn.textContent = cancelText;
            
            // Reset and apply confirm button class
            this.confirmBtn.className = 'btn ' + confirmClass;
            
            this.show();
        });
    }

    /**
     * Show a delete confirmation dialog
     */
    confirmDelete(itemName) {
        return this.confirm({
            title: 'Delete Confirmation',
            message: `<p>Are you sure you want to delete "<strong>${itemName}</strong>"?</p><p>This action cannot be undone.</p>`,
            confirmText: 'Delete',
            confirmClass: 'btn-danger'
        });
    }

    /**
     * Show a close/discard confirmation dialog
     */
    confirmClose(itemName) {
        return this.confirm({
            title: 'Unsaved Changes',
            message: `<p>Are you sure you want to close "<strong>${itemName}</strong>"?</p><p>Any unsaved changes will be lost.</p>`,
            confirmText: 'Close',
            confirmClass: 'btn-danger'
        });
    }

    /**
     * Show a custom modal with callbacks
     * @param {Object} options - Modal options
     */
    show(options = {}) {
        const {
            title = 'Modal',
            content = '',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            confirmClass = 'btn-primary',
            showCancel = true,
            onShow = null,
            onConfirm = null,
            onCancel = null
        } = options;

        // If options is empty, just show the modal (legacy behavior)
        if (Object.keys(options).length === 0) {
            this.overlay.classList.remove('hidden');
            this.confirmBtn.focus();
            return;
        }

        // Set up the modal content
        this.titleEl.textContent = title;
        this.contentEl.innerHTML = content;
        this.confirmBtn.textContent = confirmText;
        this.cancelBtn.textContent = cancelText;
        this.confirmBtn.className = 'btn ' + confirmClass;
        this.cancelBtn.style.display = showCancel ? '' : 'none';

        // Store callbacks
        this._onConfirm = onConfirm;
        this._onCancel = onCancel;

        // Show the modal
        this.overlay.classList.remove('hidden');

        // Call onShow callback
        if (onShow) {
            setTimeout(onShow, 0);
        }

        this.confirmBtn.focus();
    }

    close(result) {
        this.overlay.classList.add('hidden');
        
        // Handle custom modal with value extraction
        if (this._customResolve) {
            if (result && this._customOnConfirm) {
                const value = this._customOnConfirm();
                this._customResolve(value);
            } else {
                this._customResolve(null);
            }
            this._customResolve = null;
            this._customOnConfirm = null;
            return;
        }
        
        // Handle custom callbacks
        if (result && this._onConfirm) {
            this._onConfirm();
            this._onConfirm = null;
            this._onCancel = null;
        } else if (!result && this._onCancel) {
            this._onCancel();
            this._onConfirm = null;
            this._onCancel = null;
        }
        
        if (this.currentResolve) {
            this.currentResolve(result);
            this.currentResolve = null;
        }
    }

    /**
     * Show a simple alert (just OK button)
     */
    alert(options = {}) {
        const {
            title = 'Alert',
            message = '',
        } = options;

        return new Promise((resolve) => {
            this.currentResolve = resolve;
            
            this.titleEl.textContent = title;
            this.contentEl.innerHTML = message;
            this.confirmBtn.textContent = 'OK';
            this.confirmBtn.className = 'btn btn-primary';
            this.cancelBtn.style.display = 'none';
            
            this.show();
        }).finally(() => {
            this.cancelBtn.style.display = '';
        });
    }

    /**
     * Show a custom modal with custom content and return value extraction
     * @param {Object} options - Modal options
     * @param {string} options.title - Dialog title
     * @param {string} options.content - HTML content
     * @param {string} options.confirmText - Text for confirm button
     * @param {string} options.cancelText - Text for cancel button
     * @param {Function} options.onConfirm - Function called to get return value on confirm
     * @returns {Promise<any>} - Resolves to the value from onConfirm, or null if cancelled
     */
    custom(options = {}) {
        const {
            title = 'Modal',
            content = '',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            confirmClass = 'btn-primary',
            onConfirm = () => true
        } = options;

        return new Promise((resolve) => {
            this.titleEl.textContent = title;
            this.contentEl.innerHTML = content;
            this.confirmBtn.textContent = confirmText;
            this.cancelBtn.textContent = cancelText;
            this.confirmBtn.className = 'btn ' + confirmClass;
            this.cancelBtn.style.display = '';

            // Store the onConfirm callback for value extraction
            this._customOnConfirm = onConfirm;
            this._customResolve = resolve;

            this.overlay.classList.remove('hidden');
            this.confirmBtn.focus();
        });
    }

    /**
     * Show the user guide in a large modal with iframe
     */
    showHelp() {
        return new Promise((resolve) => {
            this.titleEl.textContent = 'User Guide';
            this.contentEl.innerHTML = `
                <iframe 
                    src="user-guide.html" 
                    class="help-iframe"
                    title="User Guide">
                </iframe>
            `;
            this.confirmBtn.textContent = 'Close';
            this.confirmBtn.className = 'btn btn-primary';
            this.cancelBtn.style.display = 'none';
            
            // Add class for larger modal
            this.dialog.classList.add('modal-help');
            
            this.currentResolve = resolve;
            this.show();
        }).finally(() => {
            this.cancelBtn.style.display = '';
            this.dialog.classList.remove('modal-help');
        });
    }

    /**
     * Show a prompt dialog with text input
     */
    prompt(options = {}) {
        const {
            title = 'Input',
            message = '',
            defaultValue = '',
            placeholder = '',
            confirmText = 'OK',
            cancelText = 'Cancel'
        } = options;

        return new Promise((resolve) => {
            const inputId = 'modal-prompt-input';
            
            this.titleEl.textContent = title;
            this.contentEl.innerHTML = `
                ${message ? `<p>${message}</p>` : ''}
                <input type="text" 
                       id="${inputId}" 
                       value="${defaultValue}" 
                       placeholder="${placeholder}"
                       style="width: 100%; padding: 8px; margin-top: 8px; 
                              background: var(--bg-tertiary); 
                              border: 1px solid var(--border-color); 
                              border-radius: 4px; 
                              color: var(--text-primary);
                              font-size: 14px;">
            `;
            this.confirmBtn.textContent = confirmText;
            this.cancelBtn.textContent = cancelText;
            this.confirmBtn.className = 'btn btn-primary';
            
            const input = document.getElementById(inputId);
            
            // Handle Enter key in input
            const handleKeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.close(input.value);
                    input.removeEventListener('keydown', handleKeydown);
                }
            };
            input.addEventListener('keydown', handleKeydown);
            
            // Store original close handler
            const originalConfirmHandler = () => {
                this.close(input.value);
            };
            
            this.confirmBtn.onclick = originalConfirmHandler;
            
            this.currentResolve = resolve;
            this.show();
            
            // Focus and select input
            setTimeout(() => {
                input.focus();
                input.select();
            }, 50);
        });
    }
}

// Singleton instance
let modalInstance = null;

export function getModal() {
    if (!modalInstance) {
        modalInstance = new ModalManager();
    }
    return modalInstance;
}

export default ModalManager;
