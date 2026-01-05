/**
 * Arrangement Editor
 * Dialog for creating and editing custom arrangements
 */

import * as State from '../state.js';
import { getModal } from './modal.js';

class ArrangementEditor {
    constructor() {
        this.modal = getModal();
        this.songId = null;
        this.editingId = null; // null for new, customId for editing
        this.draftName = '';
        this.draftSections = []; // Array of source section indices
        this.sourceSections = []; // Reference to song's source sections
    }

    /**
     * Open the arrangement editor
     * @param {string} songId - Song ID
     * @param {string|null} customId - Custom arrangement ID to edit, or null for new
     */
    open(songId, customId = null) {
        const song = State.getSong(songId);
        if (!song) return;

        this.songId = songId;
        this.editingId = customId;
        this.sourceSections = song.sections || [];

        if (customId) {
            // Editing existing - load its data
            const existing = State.getCustomArrangementById(song.songName, customId);
            if (existing) {
                this.draftName = existing.name;
                this.draftSections = [...existing.sections];
            } else {
                // Invalid ID, create new
                this.editingId = null;
                this.draftName = this.generateDefaultName(song.songName);
                this.draftSections = [];
            }
        } else {
            // New arrangement - start empty
            this.draftName = this.generateDefaultName(song.songName);
            this.draftSections = [];
        }

        this.showDialog();
    }

    /**
     * Generate a default name for a new custom arrangement
     */
    generateDefaultName(songName) {
        const existing = State.getCustomArrangements(songName);
        let num = existing.length + 1;
        let name = `Custom ${num}`;
        
        // Ensure unique name
        while (existing.some(a => a.name === name)) {
            num++;
            name = `Custom ${num}`;
        }
        
        return name;
    }

    /**
     * Show the editor dialog
     */
    showDialog() {
        const content = this.renderContent();
        
        // Add class for wider modal
        const dialog = document.getElementById('modal-dialog');
        if (dialog) {
            dialog.classList.add('modal-arrangement-editor');
        }
        
        this.modal.show({
            title: this.editingId ? 'Edit Custom Arrangement' : 'Create Custom Arrangement',
            content: content,
            confirmText: 'Save & Apply',
            cancelText: 'Cancel',
            confirmClass: 'btn-primary',
            showCancel: true,
            onShow: () => this.attachEvents(),
            onConfirm: () => {
                this.save();
                this.removeModalClass();
            },
            onCancel: () => {
                this.close();
                this.removeModalClass();
            }
        });
    }
    
    /**
     * Remove the modal-arrangement-editor class from the dialog
     */
    removeModalClass() {
        const dialog = document.getElementById('modal-dialog');
        if (dialog) {
            dialog.classList.remove('modal-arrangement-editor');
        }
    }

    /**
     * Render the editor content HTML
     */
    renderContent() {
        const sourceListHtml = this.sourceSections.map((section, index) => `
            <div class="arrangement-item source-item" data-source-index="${index}">
                <span class="item-label">${index + 1}. ${section.name}</span>
                <button class="btn-icon add-section-btn" data-index="${index}" title="Add to arrangement">+</button>
            </div>
        `).join('');

        const draftListHtml = this.renderDraftList();

        return `
            <div class="arrangement-editor">
                <div class="arrangement-editor-name">
                    <label for="arrangement-name-input">Name:</label>
                    <input type="text" id="arrangement-name-input" value="${this.escapeHtml(this.draftName)}" placeholder="Arrangement name">
                </div>
                
                <div class="arrangement-editor-panels">
                    <div class="arrangement-panel source-panel">
                        <div class="panel-header">
                            <span>Source Sections</span>
                            <button class="btn-small" id="add-all-btn">Add All</button>
                        </div>
                        <div class="panel-list" id="source-list">
                            ${sourceListHtml}
                        </div>
                    </div>
                    
                    <div class="arrangement-panel draft-panel">
                        <div class="panel-header">
                            <span>Your Arrangement</span>
                            <button class="btn-small" id="remove-all-btn">Remove All</button>
                        </div>
                        <div class="panel-list" id="draft-list">
                            ${draftListHtml}
                        </div>
                    </div>
                </div>
                
                <div class="arrangement-editor-footer">
                    <button class="btn btn-secondary" id="export-json-btn">Export JSON</button>
                    ${this.editingId ? '<button class="btn btn-danger" id="delete-arrangement-btn">Delete</button>' : ''}
                </div>
            </div>
        `;
    }

    /**
     * Render the draft list HTML
     */
    renderDraftList() {
        if (this.draftSections.length === 0) {
            return '<div class="draft-empty">Add sections from the left panel</div>';
        }

        return this.draftSections.map((sourceIndex, draftIndex) => {
            const section = this.sourceSections[sourceIndex];
            const name = section ? section.name : `Section ${sourceIndex + 1}`;
            const isFirst = draftIndex === 0;
            const isLast = draftIndex === this.draftSections.length - 1;
            
            return `
                <div class="arrangement-item draft-item" data-draft-index="${draftIndex}">
                    <span class="item-label">${sourceIndex + 1}. ${name}</span>
                    <div class="item-actions">
                        <button class="btn-icon move-up-btn" data-index="${draftIndex}" title="Move up" ${isFirst ? 'disabled' : ''}>&#9650;</button>
                        <button class="btn-icon move-down-btn" data-index="${draftIndex}" title="Move down" ${isLast ? 'disabled' : ''}>&#9660;</button>
                        <button class="btn-icon remove-btn" data-index="${draftIndex}" title="Remove">&times;</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Attach event handlers to the dialog
     */
    attachEvents() {
        // Name input
        const nameInput = document.getElementById('arrangement-name-input');
        if (nameInput) {
            nameInput.addEventListener('input', (e) => {
                this.draftName = e.target.value;
            });
        }

        // Add All button
        const addAllBtn = document.getElementById('add-all-btn');
        if (addAllBtn) {
            addAllBtn.addEventListener('click', () => this.addAllSections());
        }

        // Remove All button
        const removeAllBtn = document.getElementById('remove-all-btn');
        if (removeAllBtn) {
            removeAllBtn.addEventListener('click', () => this.removeAllSections());
        }

        // Source list - add buttons
        const sourceList = document.getElementById('source-list');
        if (sourceList) {
            sourceList.addEventListener('click', (e) => {
                const addBtn = e.target.closest('.add-section-btn');
                if (addBtn) {
                    const index = parseInt(addBtn.dataset.index, 10);
                    this.addSection(index);
                }
            });
        }

        // Draft list - move/remove buttons
        const draftList = document.getElementById('draft-list');
        if (draftList) {
            draftList.addEventListener('click', (e) => {
                const moveUpBtn = e.target.closest('.move-up-btn');
                const moveDownBtn = e.target.closest('.move-down-btn');
                const removeBtn = e.target.closest('.remove-btn');

                if (moveUpBtn && !moveUpBtn.disabled) {
                    const index = parseInt(moveUpBtn.dataset.index, 10);
                    this.moveSection(index, -1);
                } else if (moveDownBtn && !moveDownBtn.disabled) {
                    const index = parseInt(moveDownBtn.dataset.index, 10);
                    this.moveSection(index, 1);
                } else if (removeBtn) {
                    const index = parseInt(removeBtn.dataset.index, 10);
                    this.removeSection(index);
                }
            });
        }

        // Export JSON button
        const exportBtn = document.getElementById('export-json-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportJSON());
        }

        // Delete button (only shown when editing)
        const deleteBtn = document.getElementById('delete-arrangement-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.deleteArrangement());
        }
    }

    /**
     * Add a section to the draft
     */
    addSection(sourceIndex) {
        this.draftSections.push(sourceIndex);
        this.updateDraftList();
    }

    /**
     * Add all source sections in order
     */
    addAllSections() {
        for (let i = 0; i < this.sourceSections.length; i++) {
            this.draftSections.push(i);
        }
        this.updateDraftList();
    }

    /**
     * Remove a section from the draft
     */
    removeSection(draftIndex) {
        this.draftSections.splice(draftIndex, 1);
        this.updateDraftList();
    }

    /**
     * Remove all sections from the draft
     */
    removeAllSections() {
        this.draftSections = [];
        this.updateDraftList();
    }

    /**
     * Move a section up or down
     * @param {number} draftIndex - Index in draft array
     * @param {number} direction - -1 for up, +1 for down
     */
    moveSection(draftIndex, direction) {
        const newIndex = draftIndex + direction;
        if (newIndex < 0 || newIndex >= this.draftSections.length) return;

        // Swap
        const temp = this.draftSections[draftIndex];
        this.draftSections[draftIndex] = this.draftSections[newIndex];
        this.draftSections[newIndex] = temp;

        this.updateDraftList();
    }

    /**
     * Update the draft list UI
     */
    updateDraftList() {
        const draftList = document.getElementById('draft-list');
        if (draftList) {
            draftList.innerHTML = this.renderDraftList();
        }
    }

    /**
     * Save the arrangement
     */
    save() {
        const song = State.getSong(this.songId);
        if (!song) return;

        const name = this.draftName.trim() || 'Custom Arrangement';

        if (this.draftSections.length === 0) {
            // Don't save empty arrangements - just switch to Default
            State.setArrangement(this.songId, 'Default', null);
            return;
        }

        let customId;
        if (this.editingId) {
            // Update existing
            State.updateCustomArrangement(song.songName, this.editingId, name, this.draftSections);
            customId = this.editingId;
        } else {
            // Create new
            customId = State.addCustomArrangement(song.songName, name, this.draftSections);
        }

        // Set as active arrangement
        State.setArrangement(this.songId, name, customId);
    }

    /**
     * Delete the current arrangement (only when editing)
     */
    async deleteArrangement() {
        if (!this.editingId) return;

        const song = State.getSong(this.songId);
        if (!song) return;

        const arrangement = State.getCustomArrangementById(song.songName, this.editingId);
        const name = arrangement?.name || 'this arrangement';

        // Remove modal class before showing confirmation
        this.removeModalClass();
        
        const confirmed = await this.modal.confirmDelete(name);
        if (confirmed) {
            State.deleteCustomArrangement(song.songName, this.editingId);
            this.editingId = null;
            this.draftSections = [];
            // Don't re-open the editor after delete
        } else {
            // Re-open the editor if cancelled
            this.showDialog();
        }
    }

    /**
     * Export the arrangement as JSON
     */
    async exportJSON() {
        const name = this.draftName.trim() || 'Custom Arrangement';
        
        // Remove modal class before showing export dialog
        this.removeModalClass();
        
        if (this.draftSections.length === 0) {
            await this.modal.alert({
                title: 'Cannot Export',
                message: 'Add at least one section to your arrangement before exporting.'
            });
            // Re-show the editor dialog
            this.showDialog();
            return;
        }

        const song = State.getSong(this.songId);
        const songName = song?.name || song?.songName || 'Unknown';
        
        // Build JSON manually to keep sections array on one line
        const sectionsStr = '[' + this.draftSections.join(', ') + ']';
        const jsonStr = `{
\t"name": "${name}",
\t"sections": ${sectionsStr}
}`;
        
        // Build the full export text with song context
        const exportText = `Custom Arrangement For song: ${songName}\n\n${jsonStr}`;

        const content = `
            <p>Copy this and send it to an admin to add to the song's metadata:</p>
            <textarea id="export-json-text" readonly style="width: 100%; height: 160px; font-family: monospace; font-size: 12px; padding: 8px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); resize: none;">${this.escapeHtml(exportText)}</textarea>
            <button id="copy-json-btn" class="btn btn-secondary" style="margin-top: 8px;">Copy to Clipboard</button>
        `;

        // Attach copy button handler before showing alert
        setTimeout(() => {
            const copyBtn = document.getElementById('copy-json-btn');
            const textArea = document.getElementById('export-json-text');
            if (copyBtn && textArea) {
                copyBtn.addEventListener('click', async () => {
                    try {
                        await navigator.clipboard.writeText(textArea.value);
                        copyBtn.textContent = 'Copied!';
                        setTimeout(() => {
                            copyBtn.textContent = 'Copy to Clipboard';
                        }, 2000);
                    } catch (err) {
                        // Fallback - select the text
                        textArea.select();
                        textArea.setSelectionRange(0, 99999);
                    }
                });
                // Select text on focus
                textArea.addEventListener('focus', () => {
                    textArea.select();
                });
            }
        }, 0);

        await this.modal.alert({
            title: 'Export Arrangement',
            message: content
        });

        // Re-show the editor dialog after export alert closes
        this.showDialog();
    }

    /**
     * Close the editor
     */
    close() {
        // State is preserved in this instance, so re-opening will show the same draft
        this.songId = null;
    }

    /**
     * Escape HTML for safe insertion
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// Singleton instance
let editorInstance = null;

export function getArrangementEditor() {
    if (!editorInstance) {
        editorInstance = new ArrangementEditor();
    }
    return editorInstance;
}

export default ArrangementEditor;
