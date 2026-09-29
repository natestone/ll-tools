import React from 'react'

// Sample fields: first field gets three slots (18:00 / 19:30 / 20:00), others
// a single 18:00 slot.
const DEFAULT_FIELDS = [
  { name: 'Main Diamond', slots: ['18:00', '19:30', '20:00'] },
  { name: 'North Field', slots: ['18:00'] },
  { name: 'South Field', slots: ['18:00'] },
]

// Controlled list of fields. `fields` is [{ name, slots:["HH:MM"] }].
export default function FieldSetup({ fields, onChange }) {
  const filled = fields.filter(f => f.name.trim() !== '').length

  const setFields = (next) => onChange(next)

  const updateName = (i, value) => {
    const next = fields.map((f, idx) => idx === i ? { ...f, name: value } : f)
    setFields(next)
  }
  const updateSlot = (i, si, value) => {
    const next = fields.map((f, idx) => {
      if (idx !== i) return f
      const slots = f.slots.slice()
      slots[si] = value
      return { ...f, slots }
    })
    setFields(next)
  }
  const addField = () => setFields([{ name: '', slots: ['18:00'] }, ...fields])
  const removeField = (i) => setFields(fields.filter((_, idx) => idx !== i))
  const addSlot = (i) => setFields(fields.map((f, idx) => idx === i ? { ...f, slots: [...f.slots, '20:00'] } : f))
  const removeSlot = (i, si) => setFields(fields.map((f, idx) => {
    if (idx !== i) return f
    if (f.slots.length <= 1) return f
    return { ...f, slots: f.slots.filter((_, s) => s !== si) }
  }))
  const loadSample = () => setFields(DEFAULT_FIELDS.map(f => ({ name: f.name, slots: [...f.slots] })))
  const clearAll = () => setFields([{ name: '', slots: ['18:00'] }, { name: '', slots: ['18:00'] }])

  return (
    <div className="sched-section">
      <div className="sched-section-head">
        <h3>Field Setup</h3>
        <button type="button" className="sched-btn-small sched-btn-add" title="Add Field" onClick={addField}>+</button>
      </div>
      <div className="sched-count">{filled} fields entered</div>

      {fields.map((field, i) => (
        <div className="sched-field-block" key={i}>
          <div className="sched-input-row">
            <input
              type="text"
              placeholder="Enter field name"
              value={field.name}
              onChange={(e) => updateName(i, e.target.value)}
            />
            <button type="button" className="sched-btn-small sched-btn-remove" title="Remove Field" onClick={() => removeField(i)}>−</button>
          </div>
          <div className="sched-slots">
            <div className="sched-slots-label">Time Slots:</div>
            {field.slots.map((slot, si) => (
              <div className="sched-slot-row" key={si}>
                <span className="sched-slot-num">Slot {si + 1}:</span>
                <input
                  type="time"
                  className="sched-time-input"
                  value={slot}
                  onChange={(e) => updateSlot(i, si, e.target.value)}
                />
                {field.slots.length > 1 && (
                  <button type="button" className="sched-btn-small sched-btn-remove" title="Remove Time Slot" onClick={() => removeSlot(i, si)}>−</button>
                )}
              </div>
            ))}
            <button type="button" className="sched-btn-small sched-btn-add" title="Add Time Slot" onClick={() => addSlot(i)}>+</button>
          </div>
        </div>
      ))}

      <div className="sched-section-actions">
        <button type="button" className="secondary" onClick={loadSample}>Load Sample Fields</button>
        <button type="button" className="secondary" onClick={clearAll}>Clear All Fields</button>
      </div>
    </div>
  )
}
