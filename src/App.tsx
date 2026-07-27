import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  BookOpenCheck,
  Brain,
  ChevronRight,
  Clock3,
  Flame,
  HeartPulse,
  Lock,
  Mail,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Timer,
  Trophy,
  User,
  X,
  Zap,
} from 'lucide-react'
import questionsRaw from './data/pddQuestions.json'
import './App.css'

type RawAnswer = { answer_text: string; is_correct: boolean }
type RawQuestion = {
  title: string
  ticket_number: string
  ticket_category: string
  image: string | null
  question: string
  answers: RawAnswer[]
  answer_tip: string
  topic: string[]
  id: string
}

type Mode = 'feed' | 'tickets' | 'exam' | 'mistakes' | 'progress' | 'profile'
type AnswerMode = 'feed' | 'tickets' | 'exam' | 'mistakes'

type AnswerLog = {
  id: string
  mode: AnswerMode
  correct: boolean
  timeMs: number
  topic: string
  ticket: string
  at: number
}

type Profile = {
  name: string
  contact: string
  signedIn: boolean
}

type StoredAccount = {
  name: string
  contact: string
  passwordHash: string
  createdAt: number
}

type Stats = {
  solved: number
  correct: number
  xp: number
  streak: number
  lastVisit: string
  mistakes: string[]
  mastered: string[]
  feedOrder: string[]
  feedIndex: number
  totalTimeMs: number
  answerLog: AnswerLog[]
  profile: Profile
}

type ExamAnswer = { index: number; correct: boolean; extra: boolean }
type ExamState = {
  ids: string[]
  answers: Record<string, ExamAnswer>
  currentId: string | null
  started: boolean
  finished: boolean
  passed: boolean
  startedAt: number
  extraPhase: boolean
  extraAdded: number
}

type TicketAnswer = { index: number; correct: boolean; timeMs: number }
type TicketRun = {
  ticketNumber: number | null
  ids: string[]
  index: number
  answers: Record<string, TicketAnswer>
  startedAt: number
  finished: boolean
}

const STORAGE_KEY = 'pdd-state-v4'
const ACCOUNT_PREFIX = 'pdd-account:'
const ACCOUNT_STATE_PREFIX = 'pdd-account-state:'
const todayKey = () => new Date().toISOString().slice(0, 10)
const allQuestions = questionsRaw as RawQuestion[]

const shuffle = <T,>(items: T[]) => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const makeFeedOrder = () => shuffle(allQuestions.map((question) => question.id))
const accountKey = (contact: string) => `${ACCOUNT_PREFIX}${contact.trim().toLowerCase()}`
const accountStateKey = (contact: string) => `${ACCOUNT_STATE_PREFIX}${contact.trim().toLowerCase()}`

const initialStats = (): Stats => ({
  solved: 0,
  correct: 0,
  xp: 0,
  streak: 1,
  lastVisit: todayKey(),
  mistakes: [],
  mastered: [],
  feedOrder: makeFeedOrder(),
  feedIndex: 0,
  totalTimeMs: 0,
  answerLog: [],
  profile: { name: '', contact: '', signedIn: false },
})

const emptyExam = (): ExamState => ({
  ids: [],
  answers: {},
  currentId: null,
  started: false,
  finished: false,
  passed: false,
  startedAt: Date.now(),
  extraPhase: false,
  extraAdded: 0,
})

const startExam = (): ExamState => ({
  ids: shuffle(allQuestions).slice(0, 20).map((question) => question.id),
  answers: {},
  currentId: null,
  started: true,
  finished: false,
  passed: false,
  startedAt: Date.now(),
  extraPhase: false,
  extraAdded: 0,
})

const emptyTicketRun = (): TicketRun => ({
  ticketNumber: null,
  ids: [],
  index: 0,
  answers: {},
  startedAt: Date.now(),
  finished: false,
})

const loadStats = (): Stats => {
  const fresh = initialStats()
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return fresh
    const parsed = JSON.parse(saved) as Partial<Stats>
    const merged: Stats = { ...fresh, ...parsed, profile: { ...fresh.profile, ...parsed.profile } }
    const today = todayKey()
    if (merged.lastVisit === today) return merged

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const wasYesterday = merged.lastVisit === yesterday.toISOString().slice(0, 10)
    return { ...merged, streak: wasYesterday ? merged.streak + 1 : 1, lastVisit: today }
  } catch {
    return fresh
  }
}

const getLevel = (xp: number) => ({ level: Math.floor(xp / 220) + 1, progress: xp % 220, next: 220 })
const formatClock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const hashPassword = async (password: string) => {
  const data = new TextEncoder().encode(password)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const ticketNumberOf = (question: RawQuestion) => Number(question.ticket_number.replace(/\D/g, ''))
const topicOf = (question: RawQuestion) => question.topic?.[0] ?? 'ПДД'

const memoryFormula = (question: RawQuestion) => {
  const text = `${question.question} ${question.answer_tip}`.toLowerCase()
  const topic = topicOf(question)
  if (text.includes('трамва')) return 'Трамвай проверяй отдельным шагом: на равнозначной дороге он часто идет раньше машины.'
  if (text.includes('знак') || text.includes('таблич')) return 'Сначала главный знак, потом табличка. Табличка только уточняет действие знака.'
  if (text.includes('размет')) return 'Разметка отвечает за границы. Сплошная и запретные линии сразу ставят красный флаг.'
  if (text.includes('пешеход')) return 'Пешеходный переход читается раньше желания проехать. Увидел переход - ищи обязанность уступить.'
  if (text.includes('останов') || text.includes('стоян')) return 'Остановка и стоянка держатся на расстояниях: переход, перекресток, остановка, ж/д переезд.'
  if (text.includes('обгон') || text.includes('опереж')) return 'Обгон = встречная полоса. Проверяй знак, разметку, перекресток и видимость.'
  if (text.includes('скорост')) return 'Скорость зависит от места, знака, типа дороги и состояния машины.'
  if (text.includes('перекрест')) return 'Алгоритм перекрестка: регулировщик, светофор, знаки приоритета, помеха справа.'
  if (text.includes('светофор') || text.includes('регулировщик')) return 'Регулировщик сильнее светофора и знаков. Если он есть, начинай с него.'
  if (text.includes('аварийн') || text.includes('вынужден')) return 'Вынужденная ситуация = опасность или поломка. Обозначь машину и убери риск.'
  return `Тема "${topic}": ищи главный сигнал, приоритет и запрет. Так вопрос раскладывается в голове за секунды.`
}

function App() {
  const [mode, setMode] = useState<Mode>('feed')
  const [stats, setStats] = useState<Stats>(loadStats)
  const [selected, setSelected] = useState<number | null>(null)
  const [exam, setExam] = useState<ExamState>(emptyExam)
  const [ticketRun, setTicketRun] = useState<TicketRun>(emptyTicketRun)
  const [questionStartedAt, setQuestionStartedAt] = useState(Date.now())
  const [practiceStarted, setPracticeStarted] = useState<Record<'feed' | 'mistakes', boolean>>({ feed: false, mistakes: false })
  const [practiceStartedAt, setPracticeStartedAt] = useState<Record<'feed' | 'mistakes', number>>({ feed: 0, mistakes: 0 })
  const [now, setNow] = useState(Date.now())

  const questionsById = useMemo(() => new Map(allQuestions.map((question) => [question.id, question])), [])
  const tickets = useMemo(() => {
    return Array.from({ length: 40 }, (_, index) => {
      const number = index + 1
      const questions = allQuestions.filter((question) => ticketNumberOf(question) === number)
      return { number, questions, solved: questions.filter((question) => stats.mastered.includes(question.id)).length }
    })
  }, [stats.mastered])

  const currentFeedQuestion = questionsById.get(stats.feedOrder[stats.feedIndex]) ?? allQuestions[0]
  const currentMistakeQuestion = stats.mistakes.length
    ? questionsById.get(stats.mistakes[stats.feedIndex % stats.mistakes.length]) ?? currentFeedQuestion
    : currentFeedQuestion
  const currentTicketQuestion = ticketRun.ids[ticketRun.index] ? questionsById.get(ticketRun.ids[ticketRun.index]) ?? currentFeedQuestion : currentFeedQuestion
  const currentExamQuestion = exam.currentId ? questionsById.get(exam.currentId) ?? currentFeedQuestion : currentFeedQuestion
  const currentQuestion =
    mode === 'exam' ? currentExamQuestion :
    mode === 'tickets' ? currentTicketQuestion :
    mode === 'mistakes' ? currentMistakeQuestion :
    currentFeedQuestion

  const correctIndex = currentQuestion.answers.findIndex((answer) => answer.is_correct)
  const answered = selected !== null
  const level = getLevel(stats.xp)
  const accuracy = stats.solved ? Math.round((stats.correct / stats.solved) * 100) : 0
  const examElapsedMs = exam.started ? now - exam.startedAt : 0
  const ticketElapsedMs = ticketRun.ticketNumber ? now - ticketRun.startedAt : 0
  const practiceElapsedMs =
    mode === 'feed' && practiceStarted.feed ? now - practiceStartedAt.feed :
    mode === 'mistakes' && practiceStarted.mistakes ? now - practiceStartedAt.mistakes :
    0
  const sessionElapsedMs = practiceElapsedMs
  const examMistakes = Object.values(exam.answers).filter((answer) => !answer.correct).length
  const examAnswered = Object.keys(exam.answers).length

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
    if (stats.profile.signedIn && stats.profile.contact) {
      localStorage.setItem(accountStateKey(stats.profile.contact), JSON.stringify(stats))
    }
  }, [stats])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    setSelected(null)
    setQuestionStartedAt(Date.now())
  }, [mode, stats.feedIndex, ticketRun.index, ticketRun.ticketNumber, exam.currentId])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (mode === 'exam' && !exam.currentId) return
      if (['1', '2', '3', '4'].includes(event.key) && !answered) answerQuestion(Number(event.key) - 1)
      if (event.key === 'Enter' && answered && mode !== 'exam') nextQuestion()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const switchMode = (nextMode: Mode) => {
    setSelected(null)
    setMode(nextMode)
    setExam((prev) => ({ ...prev, currentId: null }))
  }

  const startPractice = (practiceMode: 'feed' | 'mistakes') => {
    setPracticeStarted((prev) => ({ ...prev, [practiceMode]: true }))
    setPracticeStartedAt((prev) => ({ ...prev, [practiceMode]: Date.now() }))
    setQuestionStartedAt(Date.now())
    setSelected(null)
  }

  const recordAnswer = (question: RawQuestion, answerIndex: number, answerMode: AnswerMode, timeMs: number) => {
    const ok = question.answers[answerIndex]?.is_correct ?? false
    const log: AnswerLog = {
      id: question.id,
      mode: answerMode,
      correct: ok,
      timeMs,
      topic: topicOf(question),
      ticket: question.ticket_number,
      at: Date.now(),
    }

    setStats((prev) => {
      const mistakes = ok ? prev.mistakes.filter((id) => id !== question.id) : Array.from(new Set([question.id, ...prev.mistakes])).slice(0, 180)
      const mastered = ok ? Array.from(new Set([question.id, ...prev.mastered])) : prev.mastered
      return {
        ...prev,
        solved: prev.solved + 1,
        correct: prev.correct + (ok ? 1 : 0),
        xp: prev.xp + (ok ? 18 : 7) + (timeMs < 8000 && ok ? 3 : 0),
        mistakes,
        mastered,
        totalTimeMs: prev.totalTimeMs + timeMs,
        answerLog: [log, ...prev.answerLog].slice(0, 1200),
      }
    })
  }

  const finishOrExtendExam = (draft: ExamState): ExamState => {
    const answers = Object.values(draft.answers)
    const answeredCount = answers.length
    const mistakes = answers.filter((answer) => !answer.correct).length
    const extraMistakes = answers.filter((answer) => answer.extra && !answer.correct).length
    if (answeredCount < draft.ids.length) return draft
    if (!draft.extraPhase) {
      if (mistakes === 0) return { ...draft, finished: true, passed: true }
      if (mistakes > 2) return { ...draft, finished: true, passed: false }
      const extraCount = mistakes * 5
      const unused = allQuestions.filter((question) => !draft.ids.includes(question.id)).map((question) => question.id)
      return { ...draft, ids: [...draft.ids, ...shuffle(unused).slice(0, extraCount)], extraPhase: true, extraAdded: extraCount }
    }
    return { ...draft, finished: true, passed: mistakes <= 2 && extraMistakes === 0 }
  }

  const answerQuestion = (answerIndex: number) => {
    if (answered) return
    const timeMs = Date.now() - questionStartedAt
    setSelected(answerIndex)

    if (mode === 'exam' && exam.currentId) {
      const ok = currentQuestion.answers[answerIndex]?.is_correct ?? false
      const isExtra = exam.ids.indexOf(exam.currentId) >= 20
      const currentId = exam.currentId
      recordAnswer(currentQuestion, answerIndex, 'exam', timeMs)
      window.setTimeout(() => {
        setSelected(null)
        setExam((prev) => finishOrExtendExam({
          ...prev,
          currentId: null,
          answers: { ...prev.answers, [currentId]: { index: answerIndex, correct: ok, extra: isExtra } },
        }))
      }, 240)
      return
    }

    const answerMode: AnswerMode = mode === 'tickets' ? 'tickets' : mode === 'mistakes' ? 'mistakes' : 'feed'
    recordAnswer(currentQuestion, answerIndex, answerMode, timeMs)

    if (mode === 'tickets' && ticketRun.ticketNumber) {
      const ok = currentQuestion.answers[answerIndex]?.is_correct ?? false
      setTicketRun((prev) => ({ ...prev, answers: { ...prev.answers, [currentQuestion.id]: { index: answerIndex, correct: ok, timeMs } } }))
    }
  }

  const nextQuestion = () => {
    setSelected(null)
    if (mode === 'tickets') {
      setTicketRun((prev) => {
        const nextIndex = prev.index + 1
        return { ...prev, index: Math.min(nextIndex, prev.ids.length - 1), finished: nextIndex >= prev.ids.length }
      })
      return
    }

    setStats((prev) => {
      if (mode === 'feed') {
        const end = prev.feedIndex + 1 >= prev.feedOrder.length
        return { ...prev, feedIndex: end ? 0 : prev.feedIndex + 1, feedOrder: end ? makeFeedOrder() : prev.feedOrder }
      }
      return { ...prev, feedIndex: prev.feedIndex + 1 }
    })
  }

  const startTicket = (ticketNumber: number) => {
    const ids = allQuestions.filter((question) => ticketNumberOf(question) === ticketNumber).map((question) => question.id)
    setSelected(null)
    setTicketRun({ ticketNumber, ids, index: 0, answers: {}, startedAt: Date.now(), finished: false })
  }

  const resetProgress = () => {
    setStats(initialStats())
    setSelected(null)
    setExam(emptyExam())
    setTicketRun(emptyTicketRun())
  }

  const registerAccount = async (name: string, contact: string, password: string) => {
    const normalized = contact.trim().toLowerCase()
    if (!name.trim() || !normalized || password.length < 4) return 'Заполни имя, контакт и пароль от 4 символов.'
    if (localStorage.getItem(accountKey(normalized))) return 'Такой аккаунт уже есть. Войди через пароль.'

    const account: StoredAccount = {
      name: name.trim(),
      contact: normalized,
      passwordHash: await hashPassword(password),
      createdAt: Date.now(),
    }
    localStorage.setItem(accountKey(normalized), JSON.stringify(account))
    setStats((prev) => ({ ...prev, profile: { name: account.name, contact: normalized, signedIn: true } }))
    return null
  }

  const loginAccount = async (contact: string, password: string) => {
    const normalized = contact.trim().toLowerCase()
    const raw = localStorage.getItem(accountKey(normalized))
    if (!raw) return 'Аккаунт не найден. Сначала зарегистрируйся.'
    const account = JSON.parse(raw) as StoredAccount
    if (account.passwordHash !== await hashPassword(password)) return 'Пароль не подошел.'

    const savedState = localStorage.getItem(accountStateKey(normalized))
    if (savedState) {
      const parsed = JSON.parse(savedState) as Stats
      setStats({ ...initialStats(), ...parsed, profile: { name: account.name, contact: normalized, signedIn: true } })
    } else {
      setStats((prev) => ({ ...prev, profile: { name: account.name, contact: normalized, signedIn: true } }))
    }
    return null
  }

  const logoutAccount = () => {
    setStats((prev) => ({ ...prev, profile: { name: '', contact: '', signedIn: false } }))
  }

  const headerTitle = {
    feed: 'Лента из 800 вопросов',
    tickets: 'Билеты',
    exam: 'Экзамен',
    mistakes: 'Ошибки',
    progress: 'Статистика',
    profile: 'Профиль',
  }[mode]

  return (
    <main className="app">
      <aside className="side-panel">
        <div className="brand">
          <div className="brand-mark"><ShieldCheck size={23} /></div>
          <div><b>ПДД</b><span>личный тренажер</span></div>
        </div>
        <div className="level-card">
          <div className="level-top"><span>Уровень {level.level}</span><b>{stats.xp} XP</b></div>
          <div className="level-bar"><i style={{ width: `${(level.progress / level.next) * 100}%` }} /></div>
          <p>{stats.profile.signedIn ? `Вход: ${stats.profile.name}` : 'Прогресс на этом устройстве'}</p>
        </div>
        <ModeList active={mode} onChange={switchMode} />
        <div className="streak"><Flame /><div><b>{stats.streak} день серии</b><span>Сегодня заход засчитан</span></div></div>
      </aside>

      <section className="trainer">
        <header className="topbar">
          <div><span className="eyebrow">{headerTitle}</span></div>
          <div className="quick-stats">
            <span><BadgeCheck size={16} /> {accuracy}%</span>
            <span><Clock3 size={16} /> {formatClock(mode === 'exam' ? examElapsedMs : mode === 'tickets' ? ticketElapsedMs : sessionElapsedMs)}</span>
            <span><X size={16} /> {stats.mistakes.length}</span>
          </div>
        </header>

        {mode === 'feed' && !practiceStarted.feed && <StartPractice modeName="ленту" onStart={() => startPractice('feed')} />}
        {mode === 'feed' && practiceStarted.feed && (
          <QuestionCard question={currentQuestion} selected={selected} correctIndex={correctIndex} onAnswer={answerQuestion} onNext={nextQuestion} revealAnswer timerMs={now - questionStartedAt} />
        )}
        {mode === 'mistakes' && !practiceStarted.mistakes && <StartPractice modeName="ошибки" onStart={() => startPractice('mistakes')} />}
        {mode === 'mistakes' && practiceStarted.mistakes && (
          <QuestionCard question={currentQuestion} selected={selected} correctIndex={correctIndex} onAnswer={answerQuestion} onNext={nextQuestion} revealAnswer timerMs={now - questionStartedAt} />
        )}
        {mode === 'tickets' && (
          <TicketsView
            tickets={tickets}
            run={ticketRun}
            currentQuestion={currentQuestion}
            selected={selected}
            correctIndex={correctIndex}
            elapsedMs={ticketElapsedMs}
            questionMs={now - questionStartedAt}
            onStart={startTicket}
            onBack={() => { setSelected(null); setTicketRun(emptyTicketRun()) }}
            onAnswer={answerQuestion}
            onNext={nextQuestion}
          />
        )}
        {mode === 'exam' && (
          <ExamView
            exam={exam}
            questionsById={questionsById}
            elapsedMs={examElapsedMs}
            answered={examAnswered}
            mistakes={examMistakes}
            selected={selected}
            currentQuestion={currentQuestion}
            correctIndex={correctIndex}
            onStart={() => { setSelected(null); setExam(startExam()) }}
            onRestart={() => { setSelected(null); setExam(startExam()) }}
            onPick={(id) => { setSelected(null); setExam((prev) => ({ ...prev, currentId: id })) }}
            onBack={() => { setSelected(null); setExam((prev) => ({ ...prev, currentId: null })) }}
            onAnswer={answerQuestion}
          />
        )}
        {mode === 'progress' && <ProgressView stats={stats} accuracy={accuracy} level={level.level} onReset={resetProgress} />}
        {mode === 'profile' && <AccountView profile={stats.profile} onRegister={registerAccount} onLogin={loginAccount} onLogout={logoutAccount} />}
      </section>
    </main>
  )
}

function ModeList({ active, onChange }: { active: Mode; onChange: (mode: Mode) => void }) {
  const items: Array<{ mode: Mode; label: string; icon: typeof Zap }> = [
    { mode: 'feed', label: 'Лента', icon: Zap },
    { mode: 'tickets', label: 'Билеты', icon: BookOpenCheck },
    { mode: 'exam', label: 'Экзамен', icon: Timer },
    { mode: 'mistakes', label: 'Ошибки', icon: HeartPulse },
    { mode: 'progress', label: 'Статистика', icon: Trophy },
    { mode: 'profile', label: 'Вход', icon: User },
  ]
  return (
    <nav className="mode-list" aria-label="Режимы тренировки">
      {items.map((item) => {
        const Icon = item.icon
        return <button key={item.mode} className={active === item.mode ? 'active' : ''} onClick={() => onChange(item.mode)} aria-label={item.label}><Icon /><span>{item.label}</span></button>
      })}
    </nav>
  )
}

function StartPractice({ modeName, onStart }: { modeName: string; onStart: () => void }) {
  return (
    <section className="exam-start">
      <div className="exam-start-mark"><Play size={34} /></div>
      <h2>Начать {modeName}</h2>
      <p>Таймер включится только после старта. Так статистика считает реальное время ответа, а не то, сколько вкладка просто была открыта.</p>
      <button onClick={onStart}><Play size={18} /> Начать</button>
    </section>
  )
}

function AccountView({ profile, onRegister, onLogin, onLogout }: {
  profile: Profile
  onRegister: (name: string, contact: string, password: string) => Promise<string | null>
  onLogin: (contact: string, password: string) => Promise<string | null>
  onLogout: () => void
}) {
  const [name, setName] = useState(profile.name)
  const [contact, setContact] = useState(profile.contact)
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [message, setMessage] = useState('')

  const submit = async () => {
    const error = authMode === 'register'
      ? await onRegister(name, contact, password)
      : await onLogin(contact, password)
    setMessage(error ?? (authMode === 'register' ? 'Аккаунт создан, прогресс привязан.' : 'Вход выполнен, прогресс загружен.'))
  }

  return (
    <section className="profile-card">
      <div className="exam-start-mark"><Lock size={32} /></div>
      <h2>{profile.signedIn ? `Аккаунт: ${profile.name}` : 'Вход и регистрация'}</h2>
      <p>Сейчас аккаунт сохраняется локально на устройстве с хэшем пароля и отдельным прогрессом. Для синхронизации между телефонами и компьютерами потом подключим облачную базу.</p>
      {!profile.signedIn && (
        <div className="auth-tabs">
          <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Вход</button>
          <button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>Регистрация</button>
        </div>
      )}
      {!profile.signedIn && authMode === 'register' && <label><User size={18} /><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя" /></label>}
      {!profile.signedIn && <label><Mail size={18} /><input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="Телефон или email" /></label>}
      {!profile.signedIn && <label><Lock size={18} /><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Пароль" type="password" /></label>}
      {message && <p className="auth-message">{message}</p>}
      {profile.signedIn ? <button onClick={onLogout}>Выйти</button> : <button onClick={submit}>{authMode === 'register' ? 'Создать аккаунт' : 'Войти'}</button>}
    </section>
  )
}

function QuestionCard({
  question,
  selected,
  correctIndex,
  onAnswer,
  onNext,
  revealAnswer,
  timerMs,
}: {
  question: RawQuestion
  selected: number | null
  correctIndex: number
  onAnswer: (index: number) => void
  onNext: () => void
  revealAnswer: boolean
  timerMs: number
}) {
  const answered = selected !== null
  const isCorrect = selected === correctIndex
  const note = memoryFormula(question)
  return (
    <article className="question-card">
      <div className="question-meta">
        <span>{question.ticket_number} / {question.title}</span>
        <span>{topicOf(question)}</span>
        <span><Clock3 size={14} /> {formatClock(timerMs)}</span>
      </div>
      <div className="media">
        {question.image ? <img src={question.image} alt="" loading="eager" /> : <div className="no-image"><BookOpenCheck size={38} /> вопрос без картинки</div>}
      </div>
      <div className="question-body">
        <h2>{question.question}</h2>
        <div className="answers">
          {question.answers.map((answer, index) => {
            const status =
              revealAnswer && answered && index === correctIndex ? 'correct' :
              revealAnswer && answered && index === selected ? 'wrong' :
              !revealAnswer && answered && index === selected ? 'picked' :
              ''
            return <button key={`${question.id}-${answer.answer_text}`} className={status} disabled={answered} onClick={() => onAnswer(index)}><b>{index + 1}</b><span>{answer.answer_text}</span></button>
          })}
        </div>
      </div>
      {revealAnswer && answered && (
        <div className={isCorrect ? 'explain good' : 'explain bad'}>
          <div className="result-line">{isCorrect ? <Sparkles /> : <Brain />}<b>{isCorrect ? 'Верно. Правило закрепилось.' : 'Ошибка полезная. Сейчас мозг ее запомнит.'}</b></div>
          <p>{question.answer_tip || 'Сначала ищи знак, разметку, светофор или приоритет. В экзамене ловят на порядке проверки.'}</p>
          <div className="memory-card"><strong>Запомни</strong><span>{note}</span></div>
          <button className="next-button" onClick={onNext}>Следующий вопрос <ChevronRight size={18} /></button>
        </div>
      )}
    </article>
  )
}

function TicketsView({
  tickets,
  run,
  currentQuestion,
  selected,
  correctIndex,
  elapsedMs,
  questionMs,
  onStart,
  onBack,
  onAnswer,
  onNext,
}: {
  tickets: Array<{ number: number; questions: RawQuestion[]; solved: number }>
  run: TicketRun
  currentQuestion: RawQuestion
  selected: number | null
  correctIndex: number
  elapsedMs: number
  questionMs: number
  onStart: (ticketNumber: number) => void
  onBack: () => void
  onAnswer: (index: number) => void
  onNext: () => void
}) {
  if (!run.ticketNumber) {
    return (
      <section className="ticket-lobby">
        <div className="section-head"><div><h2>40 билетов как в ПДД</h2><p>В каждом билете 20 вопросов. Выбирай конкретный билет или закрывай все по порядку.</p></div></div>
        <div className="ticket-select-grid">
          {tickets.map((ticket) => <button key={ticket.number} onClick={() => onStart(ticket.number)}><strong>{ticket.number}</strong><span>{ticket.solved}/{ticket.questions.length}</span></button>)}
        </div>
      </section>
    )
  }

  const correct = Object.values(run.answers).filter((answer) => answer.correct).length
  if (run.finished) {
    return (
      <section className="ticket-summary">
        <h2>Билет {run.ticketNumber}</h2>
        <p>{correct}/{run.ids.length} правильно за {formatClock(elapsedMs)}. Ошибки уже лежат в отдельном режиме.</p>
        <div className="ticket-grid compact">
          {run.ids.map((id, index) => <div key={id} className={run.answers[id]?.correct ? 'ticket-cell right' : 'ticket-cell bad'}><strong>{index + 1}</strong><span>{run.answers[id]?.correct ? 'верно' : 'ошибка'}</span></div>)}
        </div>
        <button className="next-button" onClick={onBack}>К списку билетов</button>
      </section>
    )
  }

  return (
    <>
      <div className="exam-strip"><span>Билет {run.ticketNumber}</span><span>{run.index + 1}/{run.ids.length}</span><span><Clock3 size={16} /> {formatClock(elapsedMs)}</span><button onClick={onBack}>к билетам</button></div>
      <QuestionCard question={currentQuestion} selected={selected} correctIndex={correctIndex} onAnswer={onAnswer} onNext={onNext} revealAnswer timerMs={questionMs} />
    </>
  )
}

function ExamView({
  exam,
  questionsById,
  elapsedMs,
  answered,
  mistakes,
  selected,
  currentQuestion,
  correctIndex,
  onStart,
  onRestart,
  onPick,
  onBack,
  onAnswer,
}: {
  exam: ExamState
  questionsById: Map<string, RawQuestion>
  elapsedMs: number
  answered: number
  mistakes: number
  selected: number | null
  currentQuestion: RawQuestion
  correctIndex: number
  onStart: () => void
  onRestart: () => void
  onPick: (id: string) => void
  onBack: () => void
  onAnswer: (index: number) => void
}) {
  if (!exam.started) {
    return <section className="exam-start"><div className="exam-start-mark"><Timer size={34} /></div><h2>Реальный экзамен</h2><p>После старта появится сетка из 20 закрытых вопросов. Правильность скрыта до финала.</p><button onClick={onStart}><Play size={18} /> Начать экзамен</button></section>
  }
  if (exam.currentId) {
    return (
      <>
        <div className="exam-strip"><span><Timer size={16} /> {formatClock(elapsedMs)}</span><span>{answered}/{exam.ids.length}</span><span>ответы скрыты</span><button onClick={onBack}>к сетке</button></div>
        <QuestionCard question={currentQuestion} selected={selected} correctIndex={correctIndex} onAnswer={onAnswer} onNext={onBack} revealAnswer={false} timerMs={elapsedMs} />
      </>
    )
  }
  return (
    <>
      <div className="exam-strip"><span><Timer size={16} /> {formatClock(elapsedMs)}</span><span>{answered}/{exam.ids.length}</span><span>{exam.finished ? `ошибки: ${mistakes}` : 'ответы скрыты'}</span><button onClick={onRestart}><RotateCcw size={16} /> заново</button></div>
      <section className="exam-board">
        <div className="exam-board-head"><div><h2>{exam.finished ? (exam.passed ? 'Экзамен сдан' : 'Экзамен не сдан') : 'Выбери любой вопрос'}</h2><p>{exam.finished ? 'Финальная раскраска показывает слабые места. Красное отправлено в ошибки.' : exam.extraPhase ? 'Добавлены дополнительные вопросы. Их нужно решить без ошибок.' : 'Открывай ячейки в любом порядке, как на настоящей теории.'}</p></div>{exam.extraPhase && !exam.finished && <span className="extra-badge">+{exam.extraAdded} доп</span>}</div>
        <div className="ticket-grid">
          {exam.ids.map((id, index) => {
            const answer = exam.answers[id]
            const question = questionsById.get(id)
            const isExtra = index >= 20
            const className = ['ticket-cell', answer ? 'answered' : '', exam.finished && answer?.correct ? 'right' : '', exam.finished && answer && !answer.correct ? 'bad' : '', isExtra ? 'extra' : ''].filter(Boolean).join(' ')
            return <button key={id} className={className} onClick={() => !answer && !exam.finished && onPick(id)} disabled={Boolean(answer) || exam.finished}><strong>{index + 1}</strong><span>{isExtra ? 'доп' : question?.topic?.[0] ?? 'ПДД'}</span></button>
          })}
        </div>
      </section>
    </>
  )
}

function ProgressView({ stats, accuracy, level, onReset }: { stats: Stats; accuracy: number; level: number; onReset: () => void }) {
  const avgMs = stats.answerLog.length ? stats.answerLog.reduce((sum, item) => sum + item.timeMs, 0) / stats.answerLog.length : 0
  const fastWrong = stats.answerLog.filter((item) => !item.correct && item.timeMs < 7000).length
  const slowRight = stats.answerLog.filter((item) => item.correct && item.timeMs > 25000).length
  const coverage = Math.round((stats.mastered.length / allQuestions.length) * 100)
  const ready = stats.mastered.length >= 680 && accuracy >= 92 && fastWrong <= 18 && stats.mistakes.length <= 45
  const topicRows = Object.values(stats.answerLog.reduce<Record<string, { topic: string; total: number; correct: number; time: number }>>((acc, item) => {
    acc[item.topic] ??= { topic: item.topic, total: 0, correct: 0, time: 0 }
    acc[item.topic].total += 1
    acc[item.topic].correct += item.correct ? 1 : 0
    acc[item.topic].time += item.timeMs
    return acc
  }, {})).sort((a, b) => (a.correct / a.total) - (b.correct / b.total)).slice(0, 5)

  return (
    <section className="progress-grid">
      <div className={ready ? 'metric hero-metric ready-card' : 'metric hero-metric'}><span>{ready ? 'Готов к экзамену' : 'Готовность'}</span><b>{accuracy}%</b><p>{ready ? `Покрытие ${coverage}%. Можно идти спокойно.` : `Покрытие ${coverage}%. Цель: 92%+ точности и минимум быстрых ошибок.`}</p></div>
      <div className="metric"><span>Решено</span><b>{stats.solved}</b><p>Всего активных ответов.</p></div>
      <div className="metric"><span>Среднее время</span><b>{formatClock(avgMs)}</b><p>Если долго, правило еще не автоматизировалось.</p></div>
      <div className="metric"><span>Быстрые ошибки</span><b>{fastWrong}</b><p>Импульсивные ответы. Их лечим паузой 2 секунды.</p></div>
      <div className="metric"><span>Долгие верные</span><b>{slowRight}</b><p>Знаешь, но не уверенно. Нужны повторения.</p></div>
      <div className="metric"><span>Уровень</span><b>{level}</b><p>Растет за регулярность и точность.</p></div>
      <div className="plan-card wide">
        <h2>Психологическая карта</h2>
        <p>Быстрая ошибка означает “узнал картинку, но не проверил правило”. Долгий правильный ответ означает “дошел логикой, но еще не автомат”. Идеальный режим: сначала ошибки, потом один билет, потом экзамен.</p>
      </div>
      <div className="plan-card wide">
        <h2>Слабые темы</h2>
        <div className="topic-list">
          {topicRows.length ? topicRows.map((row) => <div key={row.topic}><span>{row.topic}</span><b>{Math.round((row.correct / row.total) * 100)}% / {formatClock(row.time / row.total)}</b></div>) : <p>Пока мало данных. Реши хотя бы 20 вопросов.</p>}
        </div>
        <button onClick={onReset}><RotateCcw size={16} /> сбросить прогресс</button>
      </div>
    </section>
  )
}

export default App
