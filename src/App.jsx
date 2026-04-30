import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus2, Check, Copy, LoaderCircle, Plus, Share2, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

const STORAGE_KEY = 'quiet-schedule-events-v2'

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function nowIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function nowIsoDateTime() {
  return new Date().toISOString()
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
  const map = {}
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (!parsed || typeof parsed !== 'object') return map
    Object.entries(parsed).forEach(([key, raw]) => {
      map[key] = normalizeEvent(raw, key)
    })
    return map
  } catch {
    return map
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

function getStatus(event) {
  if (event.confirmedSlot) return '確定済み'
  if ((event.responses || []).length > 0) return '回答済み'
  return '回答待ち'
}

function statusRank(status) {
  if (status === '回答済み') return 0
  if (status === '回答待ち') return 1
  return 2
}

function formatDate(date) {
  if (!date) return '日付未設定'
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function formatDateTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`
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

function buildUrls(id) {
  const base = `${window.location.origin}${window.location.pathname}`
  return {
    guest: `${base}#/guest/${id}`,
    organizer: `${base}#/organizer/${id}`,
    confirmed: `${base}#/confirmed/${id}`
  }
}

function normalizeEvent(raw, fallbackId) {
  const id = raw?.id || raw?.eventId || fallbackId || uid()
  const urls = buildUrls(id)
  const responses = Array.isArray(raw?.responses) ? raw.responses : []
  return {
    id,
    eventName: raw?.eventName || raw?.title || '',
    purpose: raw?.purpose || '',
    duration: Number(raw?.duration || raw?.durationMin || 60),
    memo: raw?.memo || '',
    contactName: raw?.contactName || '',
    company: raw?.company || '',
    contactChannel: raw?.contactChannel || '',
    adminMemo: raw?.adminMemo || '',
    createdAt: raw?.createdAt || nowIsoDateTime(),
    responses,
    confirmedSlot: raw?.confirmedSlot || null,
    guestUrl: raw?.guestUrl || urls.guest,
    organizerUrl: raw?.organizerUrl || urls.organizer,
    confirmedUrl: raw?.confirmedUrl || urls.confirmed
  }
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
        createdAt: nowIsoDateTime(),
        guestUrl: urls.guest,
        organizerUrl: urls.organizer,
        confirmedUrl: urls.confirmed,
        responses: [],
        confirmedSlot: null,
        updatedAt: Date.now()
      }
    }))
    setNotice('日程調整を作成しました。一覧からURLをコピーできます。')
    goTo('/create')
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

  const onDeleteEvent = (id) => {
    setStore((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setNotice('日程調整を削除しました。')
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
          <DashboardScreen
            store={store}
            onCreate={onCreateEvent}
            copyText={copyText}
            copied={copied}
            onReset={resetData}
            onOpenOrganizer={(id) => goTo(`/organizer/${id}`)}
            onDeleteEvent={onDeleteEvent}
          />
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

function DashboardScreen({ store, onCreate, copyText, copied, onReset, onOpenOrganizer, onDeleteEvent }) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('すべて')
  const [sortBy, setSortBy] = useState('新しい順')

  const events = useMemo(() => Object.values(store || {}), [store])
  const stats = useMemo(() => {
    const total = events.length
    const waiting = events.filter((e) => getStatus(e) === '回答待ち').length
    const answered = events.filter((e) => getStatus(e) === '回答済み').length
    const fixed = events.filter((e) => getStatus(e) === '確定済み').length
    return { total, waiting, answered, fixed }
  }, [events])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const searched = events.filter((event) => {
      const fields = [
        event.contactName,
        event.company,
        event.eventName,
        event.purpose,
        event.contactChannel,
        event.adminMemo
      ]
        .join(' ')
        .toLowerCase()
      const status = getStatus(event)
      const hit = q ? fields.includes(q) : true
      const byStatus = statusFilter === 'すべて' ? true : status === statusFilter
      return hit && byStatus
    })
    const sorted = [...searched]
    sorted.sort((a, b) => {
      if (sortBy === '古い順') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      if (sortBy === '回答済みを上に表示') return statusRank(getStatus(a)) - statusRank(getStatus(b))
      if (sortBy === '確定済みを下に表示') {
        const aConfirmed = getStatus(a) === '確定済み' ? 1 : 0
        const bConfirmed = getStatus(b) === '確定済み' ? 1 : 0
        if (aConfirmed !== bConfirmed) return aConfirmed - bConfirmed
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
    return sorted
  }, [events, query, statusFilter, sortBy])

  return (
    <>
      <section className="dashboard-head">
        <h1>主催者ダッシュボード</h1>
        <p className="lead">URLを手動で管理しなくても、ここで相手・案件・ステータスを一元管理できます。</p>
        <div className="kpi-grid">
          <Kpi label="作成済み件数" value={stats.total} />
          <Kpi label="回答待ち" value={stats.waiting} />
          <Kpi label="回答済み" value={stats.answered} />
          <Kpi label="確定済み" value={stats.fixed} />
        </div>
      </section>

      <CreateForm onCreate={onCreate} />

      <section className="list-head">
        <h2>作成済み日程調整一覧</h2>
        <div className="toolbar">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="相手・会社・イベント名・目的・連絡場所・管理メモで検索" />
          <div className="toolbar-group">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option>すべて</option>
              <option>回答待ち</option>
              <option>回答済み</option>
              <option>確定済み</option>
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option>新しい順</option>
              <option>古い順</option>
              <option>回答済みを上に表示</option>
              <option>確定済みを下に表示</option>
            </select>
          </div>
        </div>
      </section>

      <section className="stack">
        {filtered.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            copied={copied}
            copyText={copyText}
            onOpenOrganizer={onOpenOrganizer}
            onDeleteEvent={onDeleteEvent}
          />
        ))}
      </section>

      {!filtered.length && <div className="empty">条件に合う日程調整が見つかりません。</div>}

      <button className="link-btn" onClick={onReset}>
        テストデータをリセット
      </button>
    </>
  )
}

function CreateForm({ onCreate }) {
  const [eventName, setEventName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [duration, setDuration] = useState('60')
  const [memo, setMemo] = useState('')
  const [contactName, setContactName] = useState('')
  const [company, setCompany] = useState('')
  const [contactChannel, setContactChannel] = useState('')
  const [adminMemo, setAdminMemo] = useState('')
  const [error, setError] = useState('')

  const canSubmit = eventName.trim() && purpose.trim() && contactName.trim() && Number(duration) > 0

  const submit = () => {
    if (!canSubmit) {
      setError('相手の名前・イベント名・目的・所要時間を入力してください。')
      return
    }
    setError('')
    onCreate({
      eventName: eventName.trim(),
      purpose: purpose.trim(),
      duration: Number(duration),
      memo: memo.trim(),
      contactName: contactName.trim(),
      company: company.trim(),
      contactChannel: contactChannel.trim(),
      adminMemo: adminMemo.trim()
    })
    setEventName('')
    setPurpose('')
    setDuration('60')
    setMemo('')
    setContactName('')
    setCompany('')
    setContactChannel('')
    setAdminMemo('')
  }

  return (
    <section className="create-card">
      <h2>新規日程調整作成</h2>
      <section className="stack">
        <div className="grid two">
          <Field label="相手の名前" required>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="例: Alex / 田中さん" />
          </Field>
          <Field label="会社名 / 所属">
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="例: Studio A / Freelance" />
          </Field>
        </div>
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
        <div className="grid two">
          <Field label="連絡場所">
            <input value={contactChannel} onChange={(e) => setContactChannel(e.target.value)} placeholder="例: Instagram DM / Gmail / LINE" />
          </Field>
          <Field label="管理用メモ">
            <input value={adminMemo} onChange={(e) => setAdminMemo(e.target.value)} placeholder="例: 先方の返信は夜が多い" />
          </Field>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      <button className="btn primary" disabled={!canSubmit} onClick={submit}>
        URLを生成する
      </button>
    </section>
  )
}

function Kpi({ label, value }) {
  return (
    <div className="kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function EventCard({ event, copied, copyText, onOpenOrganizer, onDeleteEvent }) {
  const status = getStatus(event)
  const statusClass = status === '回答待ち' ? 'waiting' : status === '回答済み' ? 'answered' : 'confirmed'
  const responseCount = (event.responses || []).length
  const jpMessage = `${event.contactName || 'ご担当者'}さん、以下のURLからご都合の良い候補日時を3つほど入力してください。\n\n${event.guestUrl}\n\nよろしくお願いします。`
  const enMessage = `Hi ${event.contactName || ''},\n\nPlease share at least three time options from the link below.\n\n${event.guestUrl}\n\nThank you.`
  const remove = () => {
    const ok = window.confirm(`「${event.contactName || '相手未設定'} / ${event.eventName || 'イベント未設定'}」を削除しますか？`)
    if (!ok) return
    onDeleteEvent(event.id)
  }

  return (
    <article className="event-card">
      <div className="event-top">
        <div>
          <h3>{event.contactName || '名前未設定'}</h3>
          <p className="muted">
            {event.company || '所属未設定'} / {event.eventName || 'イベント未設定'}
          </p>
        </div>
        <span className={`status-pill ${statusClass}`}>{status}</span>
      </div>

      <p className="muted">{event.purpose || '目的未設定'}</p>
      <div className="meta-grid">
        <Meta label="作成日" value={formatDateTime(event.createdAt)} />
        <Meta label="回答数" value={`${responseCount}件`} />
        <Meta label="連絡場所" value={event.contactChannel || '-'} />
        <Meta label="管理用メモ" value={event.adminMemo || '-'} />
        {event.confirmedSlot && <Meta label="確定日時" value={formatSlot(event.confirmedSlot)} />}
      </div>

      <div className="event-actions">
        <button className="btn subtle" onClick={() => copyText(event.guestUrl, `guest-${event.id}`)}>
          {copied === `guest-${event.id}` ? 'コピーしました' : '相手に送るURLをコピー'}
        </button>
        <button className="btn subtle" onClick={() => onOpenOrganizer(event.id)}>
          自分で候補を見る
        </button>
        <button className="btn subtle" onClick={() => copyText(event.confirmedUrl, `confirmed-${event.id}`)}>
          {copied === `confirmed-${event.id}` ? 'コピーしました' : '確定URLをコピー'}
        </button>
      </div>
      <div className="event-actions">
        <button className="btn subtle" onClick={() => copyText(jpMessage, `jpmsg-${event.id}`)}>
          {copied === `jpmsg-${event.id}` ? 'コピーしました' : '送信用メッセージをコピー（日本語）'}
        </button>
        <button className="btn subtle" onClick={() => copyText(enMessage, `enmsg-${event.id}`)}>
          {copied === `enmsg-${event.id}` ? 'コピーしました' : 'Send message (English)'}
        </button>
        <button className="btn subtle danger" onClick={remove}>
          この日程調整を削除
        </button>
      </div>
    </article>
  )
}

function Meta({ label, value }) {
  return (
    <div className="meta-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
      <section className="summary soft">
        <SummaryRow label="相手の名前" value={event.contactName || '-'} />
        <SummaryRow label="会社名 / 所属" value={event.company || '-'} />
        <SummaryRow label="イベント名" value={event.eventName || '-'} />
        <SummaryRow label="目的" value={event.purpose || '-'} />
        <SummaryRow label="連絡場所" value={event.contactChannel || '-'} />
        <SummaryRow label="管理用メモ" value={event.adminMemo || '-'} />
      </section>
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
        <SummaryRow label="相手の名前" value={event.contactName || '-'} />
        <SummaryRow label="イベント名" value={event.eventName} />
        <SummaryRow label="目的" value={event.purpose} />
        <SummaryRow label="確定日時" value={formatSlot(slot)} />
        <SummaryRow label="所要時間" value={`${event.duration}分`} />
        <SummaryRow label="メモ" value={event.memo || 'なし'} />
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