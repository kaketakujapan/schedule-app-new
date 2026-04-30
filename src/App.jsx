import { useEffect, useState } from 'react'
import { CalendarPlus2, Check, Copy, LoaderCircle, Plus, Share2, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

const STORAGE_KEY = 'quiet-schedule-events-v2'

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function nowIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function emptyCandidate() {
  return {
    id: uid(),
    date: nowIsoDate(),
    timeText: '',
    memo: ''
  }
}

function readStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

function parseRoute() {
  const hash = window.location.hash || '#/'
  const clean = hash.replace(/^#/, '')
  const [, rawRole, eventId] = clean.split('/')
  const role = rawRole && rawRole.trim() ? rawRole : 'create'
  return { role, eventId: eventId || null }
}

function goTo(hashPath) {
  window.location.hash = hashPath
}

function formatDate(date) {
  if (!date) return '日付未設定'
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function formatSlot(slot) {
  return `${formatDate(slot?.date)} ${slot?.timeText || ''}`.trim()
}

function pad(num) {
  return String(num).padStart(2, '0')
}

function toIcsDate(dateObj) {
  return `${dateObj.getFullYear()}${pad(dateObj.getMonth() + 1)}${pad(dateObj.getDate())}T${pad(dateObj.getHours())}${pad(dateObj.getMinutes())}00`
}

function addMinutes(dateObj, minutes) {
  return new Date(dateObj.getTime() + minutes * 60 * 1000)
}

function parseTimeRange(text) {
  const m = text.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/)
  if (!m) return null
  return {
    sh: Number(m[1]),
    sm: Number(m[2]),
    eh: Number(m[3]),
    em: Number(m[4])
  }
}

function createIcs(event, slot) {
  const range = parseTimeRange(slot.timeText || '')
  const date = slot.date || nowIsoDate()
  const [y, m, d] = date.split('-').map(Number)
  const fallbackStart = new Date(y, (m || 1) - 1, d || 1, 9, 0, 0)
  const start = range ? new Date(y, (m || 1) - 1, d || 1, range.sh, range.sm, 0) : fallbackStart
  const end = range
    ? new Date(y, (m || 1) - 1, d || 1, range.eh, range.em, 0)
    : addMinutes(fallbackStart, Number(event.duration || 60))

  const allDay = !range
  const stamp = toIcsDate(new Date())
  const descriptionLines = [
    event.purpose || '',
    event.memo ? `メモ: ${event.memo}` : '',
    !range && slot.timeText ? `入力された時間情報: ${slot.timeText}` : ''
  ].filter(Boolean)

  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Quiet Schedule//JA',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.id}@quiet-schedule.local`,
    `DTSTAMP:${stamp}`,
    allDay ? `DTSTART;VALUE=DATE:${date.replaceAll('-', '')}` : `DTSTART:${toIcsDate(start)}`,
    allDay
      ? `DTEND;VALUE=DATE:${toIcsDate(addMinutes(start, 1440)).slice(0, 8)}`
      : `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${event.eventName || '日程調整イベント'}`,
    `DESCRIPTION:${descriptionLines.join('\\n').replace(/\n/g, ' ')}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
  return new Blob([body], { type: 'text/calendar;charset=utf-8' })
}

function App() {
  const [route, setRoute] = useState(parseRoute())
  const [store, setStore] = useState(readStore)
  const [copied, setCopied] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const onHash = () => {
      setLoading(true)
      setRoute(parseRoute())
      setTimeout(() => setLoading(false), 220)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    writeStore(store)
  }, [store])

  const event = route.eventId ? store[route.eventId] : null

  const buildUrls = (id) => {
    const base = `${window.location.origin}${window.location.pathname}`
    return {
      guest: `${base}#/guest/${id}`,
      organizer: `${base}#/organizer/${id}`,
      confirmed: `${base}#/confirmed/${id}`
    }
  }

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(''), 1200)
    } catch {
      setNotice('コピーに失敗しました。ブラウザ権限をご確認ください。')
    }
  }

  const onCreateEvent = (payload) => {
    const id = uid()
    const urls = buildUrls(id)
    setStore((prev) => ({
      ...prev,
      [id]: {
        id,
        ...payload,
        eventId: id,
        guestUrl: urls.guest,
        organizerUrl: urls.organizer,
        confirmedUrl: urls.confirmed,
        responses: [],
        confirmedSlot: null,
        updatedAt: Date.now()
      }
    }))
    goTo(`/create/${id}`)
  }

  const onSubmitResponses = (id, payload) => {
    setStore((prev) => {
      if (!prev[id]) return prev
      return {
        ...prev,
        [id]: {
          ...prev[id],
          responses: [
            {
              id: uid(),
              respondentName: payload.respondentName || '',
              slots: payload.slots,
              submittedAt: Date.now()
            }
          ],
          updatedAt: Date.now()
        }
      }
    })
  }

  const onConfirm = (id, slot) => {
    setStore((prev) => {
      if (!prev[id]) return prev
      return {
        ...prev,
        [id]: {
          ...prev[id],
          confirmedSlot: slot,
          updatedAt: Date.now()
        }
      }
    })
    goTo(`/confirmed/${id}`)
  }

  const resetData = () => {
    localStorage.removeItem(STORAGE_KEY)
    setStore({})
    setNotice('テストデータをリセットしました')
    goTo('/')
  }

  const currentStep =
    route.role === 'guest' ? 2 : route.role === 'organizer' ? 3 : route.role === 'confirmed' ? 4 : 1

  return (
    <div className="app-shell">
      <motion.main
        key={`${route.role}-${route.eventId || 'home'}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
        className="panel"
      >
        <Brand />
        <StepIndicator current={currentStep} />
        {loading && (
          <div className="loading">
            <LoaderCircle size={16} className="spin" />
            画面を読み込み中...
          </div>
        )}
        {!loading && route.role === 'create' && (
          <CreateScreen event={event} onCreate={onCreateEvent} copyText={copyText} copied={copied} onReset={resetData} />
        )}
        {!loading && route.role === 'guest' && event && <GuestScreen event={event} onSubmitResponses={onSubmitResponses} />}
        {!loading && route.role === 'organizer' && event && <OrganizerScreen event={event} onConfirm={onConfirm} copyText={copyText} copied={copied} />}
        {!loading && route.role === 'confirmed' && event && <ConfirmedScreen event={event} copyText={copyText} copied={copied} />}
        {(route.role === 'guest' || route.role === 'organizer' || route.role === 'confirmed') && !event && <NotFound />}
      </motion.main>
      <AnimatePresence>{notice && <Toast text={notice} onDone={() => setNotice('')} />}</AnimatePresence>
    </div>
  )
}

function Brand() {
  return <p className="brand">Quiet Schedule</p>
}

function StepIndicator({ current }) {
  const steps = ['作成', '候補入力', '確定', '共有']
  return (
    <ol className="steps">
      {steps.map((label, idx) => (
        <li key={label} className={current >= idx + 1 ? 'active' : ''}>
          <span>{idx + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  )
}

function CreateScreen({ event, onCreate, copyText, copied, onReset }) {
  const [eventName, setEventName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [duration, setDuration] = useState('60')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')

  const canSubmit = eventName.trim() && purpose.trim() && Number(duration) > 0

  const submit = () => {
    if (!canSubmit) {
      setError('イベント名・目的・所要時間を入力してください。')
      return
    }
    setError('')
    onCreate({
      eventName: eventName.trim(),
      purpose: purpose.trim(),
      duration: Number(duration),
      memo: memo.trim()
    })
  }

  return (
    <>
      <h1>新しい日程調整を作成</h1>
      <p className="lead">イベントの目的だけを共有し、候補日時は相手から集めます。最後に主催者が一つを選び、確定URLを共有できます。</p>

      <section className="stack">
        <Field label="イベント名" required>
          <input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="例: 初回キックオフ" />
        </Field>
        <Field label="目的" required>
          <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="何を決める打ち合わせか" rows={3} />
        </Field>
        <div className="grid two">
          <Field label="所要時間（分）" required>
            <input type="number" min="15" step="15" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
          <Field label="メモ">
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="任意" />
          </Field>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      <button className="btn primary" disabled={!canSubmit} onClick={submit}>
        URLを生成する
      </button>

      {event && (
        <section className="created-box">
          <h2>URLを発行しました</h2>
          <p className="muted">この時点では候補日時はまだありません。回答者にURLを共有して入力してもらってください。</p>
          <UrlRow label="回答者用URL" url={event.guestUrl} onCopy={() => copyText(event.guestUrl, 'guest')} copied={copied === 'guest'} />
          <UrlRow label="主催者用URL" url={event.organizerUrl} onCopy={() => copyText(event.organizerUrl, 'organizer')} copied={copied === 'organizer'} />
        </section>
      )}

      <button className="link-btn" onClick={onReset}>
        テストデータをリセット
      </button>
    </>
  )
}

function GuestScreen({ event, onSubmitResponses }) {
  const [respondentName, setRespondentName] = useState('')
  const [slots, setSlots] = useState([emptyCandidate(), emptyCandidate(), emptyCandidate()])
  const [errorList, setErrorList] = useState([])
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [done, setDone] = useState(false)

  const updateSlot = (id, key, value) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, [key]: value } : s)))
  }

  const addSlot = () => setSlots((prev) => [...prev, emptyCandidate()])

  const removeSlot = (id) => {
    setSlots((prev) => {
      if (prev.length <= 3) return prev
      return prev.filter((s) => s.id !== id)
    })
  }

  const validate = () => {
    const messages = []
    const fieldErrors = {
      respondentName: false,
      slots: {}
    }

    if (!respondentName.trim()) {
      fieldErrors.respondentName = true
      messages.push('回答者名を入力してください。')
    }

    slots.forEach((slot, idx) => {
      const slotError = { date: false, timeText: false }
      if (!slot.date) {
        slotError.date = true
        messages.push(`候補日時 ${idx + 1} の日付を選択してください。`)
      }
      if (!slot.timeText.trim()) {
        slotError.timeText = true
        messages.push(`候補日時 ${idx + 1} の時間を入力してください。`)
      }
      fieldErrors.slots[slot.id] = slotError
    })

    return { isValid: messages.length === 0, messages, fieldErrors }
  }

  const validation = validate()

  const submit = () => {
    setAttemptedSubmit(true)
    if (!validation.isValid) {
      setErrorList(validation.messages)
      setDone(false)
      return
    }
    setErrorList([])
    onSubmitResponses(event.id, {
      respondentName: respondentName.trim(),
      slots: slots.map((s) => ({ ...s, timeText: s.timeText.trim(), memo: s.memo.trim() }))
    })
    setDone(true)
  }

  return (
    <>
      <h1>候補日時を入力</h1>
      <p className="lead">参加しやすい日時を3つ以上入力してください。時間帯は 15:00-17:00 のように自由に書けます。</p>
      <p className="subject">{event.eventName} / {event.purpose}</p>

      <section className="stack">
        <Field label="回答者名" required>
          <input
            value={respondentName}
            onChange={(e) => setRespondentName(e.target.value)}
            placeholder="例: 山田"
            className={attemptedSubmit && validation.fieldErrors.respondentName ? 'input-error' : ''}
          />
        </Field>
        {slots.map((slot, idx) => (
          <article key={slot.id} className="candidate">
            <div className="candidate-head">
              <h3>候補日時 {idx + 1}</h3>
              <button className="icon-btn" onClick={() => removeSlot(slot.id)} disabled={slots.length <= 3} aria-label="候補日時を削除">
                <Trash2 size={16} />
              </button>
            </div>
            <div className="grid two">
              <Field label="日付" required>
                <input
                  type="date"
                  min={nowIsoDate()}
                  value={slot.date}
                  onChange={(e) => updateSlot(slot.id, 'date', e.target.value)}
                  className={attemptedSubmit && validation.fieldErrors.slots[slot.id]?.date ? 'input-error' : ''}
                />
              </Field>
              <Field label="時間" required>
                <input
                  value={slot.timeText}
                  onChange={(e) => updateSlot(slot.id, 'timeText', e.target.value)}
                  placeholder="例：15:00-17:00 / 午後ならいつでも"
                  className={attemptedSubmit && validation.fieldErrors.slots[slot.id]?.timeText ? 'input-error' : ''}
                />
              </Field>
            </div>
            <Field label="メモ（任意）">
              <textarea
                rows={2}
                value={slot.memo || ''}
                onChange={(e) => updateSlot(slot.id, 'memo', e.target.value)}
                placeholder="例：この日は夕方なら可能 / オンラインなら可"
              />
            </Field>
          </article>
        ))}
      </section>

      <div className="actions">
        <button className="btn subtle" onClick={addSlot}>
          <Plus size={16} />
          候補を追加
        </button>
        <button className="btn primary" onClick={submit}>
          候補を送信
        </button>
      </div>

      {!!errorList.length && (
        <div className="error">
          <p>未入力の項目があります。次をご確認ください。</p>
          <ul className="error-list">
            {errorList.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      )}
      {done && (
        <div className="done">
          <Check size={16} />
          候補を送信しました
        </div>
      )}
    </>
  )
}

function flattenResponseSlots(event) {
  const responses = event.responses || []
  const items = []
  responses.forEach((r) => {
    ;(r.slots || []).forEach((s) => {
      items.push({
        slotId: s.id,
        date: s.date,
        timeText: s.timeText,
        memo: s.memo || '',
        respondentName: r.respondentName || ''
      })
    })
  })
  return items
}

function OrganizerScreen({ event, onConfirm, copyText, copied }) {
  const items = flattenResponseSlots(event)
  const [selectedSlotId, setSelectedSlotId] = useState('')
  const [editedTimes, setEditedTimes] = useState({})
  const [meetingUrl, setMeetingUrl] = useState('')
  const [confirmError, setConfirmError] = useState('')

  const selected = items.find((it) => it.slotId === selectedSlotId)

  useEffect(() => {
    const next = {}
    items.forEach((slot) => {
      next[slot.slotId] = ''
    })
    setEditedTimes(next)
  }, [event.responses])

  useEffect(() => {
    if (!selected) return
    setMeetingUrl(selected.meetingUrl || '')
    setConfirmError('')
  }, [selectedSlotId])

  const submitConfirm = () => {
    if (!selected) return
    const finalTimeText = (editedTimes[selected.slotId] || '').trim()
    if (!finalTimeText) {
      setConfirmError('確定する時間を入力してください。')
      return
    }
    onConfirm(event.id, { ...selected, timeText: finalTimeText, meetingUrl: meetingUrl.trim() })
  }

  return (
    <>
      <h1>届いた候補から確定</h1>
      <p className="lead">回答者が入力した候補日時を確認し、最終的な日程を一つ選んでください。</p>
      <p className="subject">{event.eventName} / {event.purpose}</p>

      <section className="url-list">
        <UrlRow label="回答者用URL" url={event.guestUrl} onCopy={() => copyText(event.guestUrl, 'guest')} copied={copied === 'guest'} />
        <UrlRow label="主催者用URL" url={event.organizerUrl} onCopy={() => copyText(event.organizerUrl, 'organizer')} copied={copied === 'organizer'} />
      </section>

      {!items.length && (
        <div className="empty">
          <p>まだ候補が届いていません。</p>
          <p>回答者用URLを相手に送って、候補日時を入力してもらってください。</p>
        </div>
      )}

      {!!items.length && (
        <>
          <section className="stack">
            {items.map((slot) => (
              <article
                key={slot.slotId}
                className={`candidate selectable ${selectedSlotId === slot.slotId ? 'selected' : ''}`}
                onClick={() => setSelectedSlotId(slot.slotId)}
              >
                <div className="candidate-head">
                  <h3>{formatDate(slot.date)}</h3>
                  {slot.respondentName && <span className="period-chip">{slot.respondentName}</span>}
                </div>
                <div className="inline-time-wrap">
                  <input
                    value={editedTimes[slot.slotId] || ''}
                    onChange={(e) => setEditedTimes((prev) => ({ ...prev, [slot.slotId]: e.target.value }))}
                    placeholder={slot.timeText || 'ここに確定する時間を入力'}
                    className={confirmError && selectedSlotId === slot.slotId && !(editedTimes[slot.slotId] || '').trim() ? 'input-error' : ''}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setSelectedSlotId(slot.slotId)}
                  />
                </div>
                <p className="muted">{slot.memo || 'メモなし'}</p>
              </article>
            ))}
          </section>
          <Field label="オンラインミーティングURL">
            <input
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder="例：https://meet.google.com/xxx-xxxx-xxx"
              disabled={!selected}
            />
          </Field>
          {confirmError && <div className="error">{confirmError}</div>}
          <button className="btn primary" disabled={!selected} onClick={submitConfirm}>
            <Check size={16} />
            この日に確定する
          </button>
        </>
      )}

      {event.confirmedSlot && (
        <section className="created-box">
          <h2>確定URL</h2>
          <UrlRow
            label="確定URL"
            url={event.confirmedUrl}
            onCopy={() => copyText(event.confirmedUrl, 'confirmed')}
            copied={copied === 'confirmed'}
          />
        </section>
      )}
    </>
  )
}

function ConfirmedScreen({ event, copyText, copied }) {
  const slot = event.confirmedSlot

  const onDownloadIcs = () => {
    if (!slot) return
    const blob = createIcs(event, slot)
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `${event.eventName || 'event'}.ics`
    a.click()
    URL.revokeObjectURL(href)
  }

  const onShare = async () => {
    if (!slot) return
    const text = `${event.eventName}\n${formatSlot(slot)} に決まりました`
    if (navigator.share) {
      try {
        await navigator.share({ title: event.eventName, text, url: event.confirmedUrl })
        return
      } catch {
        // ignore
      }
    }
    copyText(event.confirmedUrl, 'confirmed')
  }

  if (!slot) {
    return <NotFound message="まだ日程が確定していません。" />
  }

  return (
    <>
      <h1>日程が確定しました</h1>
      <p className="lead">{formatSlot(slot)} に決まりました</p>

      <section className="summary">
        <SummaryRow label="イベント名" value={event.eventName} />
        <SummaryRow label="目的" value={event.purpose} />
        <SummaryRow label="所要時間" value={`${event.duration}分`} />
        <SummaryRow label="メモ" value={event.memo || 'なし'} />
        <SummaryRow label="確定した候補日時" value={formatSlot(slot)} />
        {slot.meetingUrl && <SummaryRow label="オンラインURL" value={slot.meetingUrl} />}
      </section>

      <div className="actions">
        <button className="btn subtle" onClick={onDownloadIcs}>
          <CalendarPlus2 size={16} />
          予定をカレンダーに追加
        </button>
        <button className="btn primary" onClick={onShare}>
          <Share2 size={16} />
          {copied === 'confirmed' ? 'コピーしました' : 'この決定をシェア'}
        </button>
      </div>
    </>
  )
}

function UrlRow({ label, url, onCopy, copied }) {
  return (
    <div className="url-row">
      <span>{label}</span>
      <code>{url}</code>
      <button className="icon-btn" onClick={onCopy} aria-label={`${label}をコピー`}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  )
}

function Field({ label, children, required = false }) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
    </label>
  )
}

function SummaryRow({ label, value }) {
  return (
    <div className="summary-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function NotFound({ message = 'イベントが見つかりません。URLをご確認ください。' }) {
  return (
    <>
      <h1>対象のイベントが見つかりません</h1>
      <p className="lead">{message}</p>
      <button className="btn subtle" onClick={() => goTo('/')}>
        作成画面へ戻る
      </button>
    </>
  )
}

function Toast({ text, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="toast">
      {text}
    </motion.div>
  )
}

export default App