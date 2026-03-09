/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';
import { 
  User, 
  BookOpen, 
  Timer, 
  CheckCircle2, 
  XCircle, 
  ChevronRight, 
  AlertTriangle,
  Loader2,
  Settings,
  Plus,
  FileSpreadsheet,
  Trash2,
  LogOut,
  ChevronLeft,
  LayoutDashboard,
  ClipboardList,
  FileUp,
  FileText,
  Calendar,
  Clock,
  Lock,
  Edit3,
  Image as ImageIcon,
  X
} from 'lucide-react';

interface Subject {
  id: number;
  name: string;
  start_time?: string;
  end_time?: string;
}

interface Question {
  id: number;
  question: string;
  image?: string;
  options: string[];
}

interface QuizQuestion extends Question {
  optionOrder: number[];
}

interface QuizAutosaveQuestionState {
  id: number;
  optionOrder: number[];
}

interface StudentDataForm {
  name: string;
  nis: string;
  class: string;
}

interface QuizAutosavePayload {
  subjectId: number;
  studentData: StudentDataForm;
  questionStates: QuizAutosaveQuestionState[];
  currentIndex: number;
  completedIndices: number[];
  userAnswers: { id: number; selectedIndex: number }[];
  draftSelectedOption: number | null;
}

interface QuizResult {
  score: number;
  correctCount: number;
  total: number;
  results: {
    id: number;
    question: string;
    options: string[];
    correctAnswer: number;
    userAnswer: number;
    isCorrect: boolean;
  }[];
}

interface StudentResult {
  id: number;
  student_name: string;
  nis: string;
  class: string;
  subject_id: number;
  subject_name: string;
  score: number;
  correct_count: number;
  total_questions: number;
  timestamp: string;
}

const MIN_TIME_PER_QUESTION = 20; // 20 seconds
const QUIZ_AUTOSAVE_PREFIX = 'quiz-autosave';
const QUIZ_DIAGNOSTIC_KEY = 'quiz-diagnostics';
const QUIZ_DIAGNOSTIC_LIMIT = 80;

interface QuizDiagnosticEntry {
  at: string;
  type: string;
  sessionId: string;
  step: string;
  subjectId: number | null;
  currentIndex: number;
  questionCount: number;
  details?: Record<string, unknown>;
}

const appendQuizDiagnosticEntry = (entry: QuizDiagnosticEntry) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUIZ_DIAGNOSTIC_KEY) ?? '[]');
    const existing = Array.isArray(parsed) ? parsed : [];
    const next = [...existing, entry].slice(-QUIZ_DIAGNOSTIC_LIMIT);
    localStorage.setItem(QUIZ_DIAGNOSTIC_KEY, JSON.stringify(next));
  } catch (error) {
    console.error('Failed to store quiz diagnostic entry', error);
  }
};

const downloadQuizDiagnostics = () => {
  try {
    const raw = localStorage.getItem(QUIZ_DIAGNOSTIC_KEY) ?? '[]';
    const blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `quiz-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to download quiz diagnostics', error);
  }
};

const FormattedText = React.memo(function FormattedText({ text }: { text: string }) {
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$.*?\$)/g);
  return (
    <div className="prose prose-slate max-w-none">
      {parts.map((part, i) => {
        if (part.startsWith('$$') && part.endsWith('$$')) {
          return <BlockMath key={i} math={part.slice(2, -2)} />;
        }
        if (part.startsWith('$') && part.endsWith('$')) {
          return <InlineMath key={i} math={part.slice(1, -1)} />;
        }
        return (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
            {part}
          </ReactMarkdown>
        );
      })}
    </div>
  );
});

class QuizRenderBoundary extends React.Component<
  { resetKey: string; children: React.ReactNode; onRenderError?: (error: Error, errorInfo: React.ErrorInfo) => void; onDownloadDiagnostics?: () => void },
  { hasError: boolean }
> {
  constructor(props: { resetKey: string; children: React.ReactNode; onRenderError?: (error: Error, errorInfo: React.ErrorInfo) => void; onDownloadDiagnostics?: () => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.props.onRenderError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={28} />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">Tampilan soal gagal dimuat</h3>
          <p className="text-sm text-slate-500 mb-6">
            Progress tersimpan. Muat ulang halaman untuk melanjutkan ujian dari posisi terakhir.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => this.props.onDownloadDiagnostics?.()}
              className="border border-slate-200 text-slate-600 font-semibold px-6 py-3 rounded-xl hover:bg-slate-50 transition-all"
            >
              Unduh Log Diagnosa
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="bg-indigo-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-indigo-700 transition-all"
            >
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [step, setStep] = useState<'setup' | 'subject_selection' | 'quiz' | 'result' | 'admin_login' | 'admin_dashboard'>('setup');
  const [studentData, setStudentData] = useState<StudentDataForm>({ name: '', nis: '', class: '' });
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completedIndices, setCompletedIndices] = useState<Set<number>>(new Set());
  const [userAnswers, setUserAnswers] = useState<{ id: number; selectedIndex: number }[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(MIN_TIME_PER_QUESTION);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDisqualified, setIsDisqualified] = useState(false);
  const [lastAutosaveAt, setLastAutosaveAt] = useState<string | null>(null);

  // Admin States
  const [adminToken, setAdminToken] = useState<string | null>(localStorage.getItem('adminToken'));
  const [adminPassword, setAdminPassword] = useState('');
  const [adminResults, setAdminResults] = useState<StudentResult[]>([]);
  const [adminView, setAdminView] = useState<'results' | 'questions' | 'schedule'>('results');

  const groupedResults = React.useMemo(() => {
    return adminResults.reduce((acc, res) => {
      if (!acc[res.subject_name]) acc[res.subject_name] = [];
      acc[res.subject_name].push(res);
      return acc;
    }, {} as Record<string, StudentResult[]>);
  }, [adminResults]);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newQuestion, setNewQuestion] = useState({ question: '', image: '', options: ['', '', '', '', ''], answer: 0 });
  const [isUploadingBulk, setIsUploadingBulk] = useState(false);
  const [isAdminLoading, setIsAdminLoading] = useState(false);
  const [bulkQuestions, setBulkQuestions] = useState<any[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<{ id: number, start: string, end: string } | null>(null);
  const [adminQuestions, setAdminQuestions] = useState<any[]>([]);
  const [editingQuestion, setEditingQuestion] = useState<any | null>(null);
  const [deletingSubjectId, setDeletingSubjectId] = useState<number | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isPageUnloadingRef = useRef(false);
  const diagnosticSessionRef = useRef(`quiz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const diagnosticContextRef = useRef({
    step: 'setup',
    subjectId: null as number | null,
    currentIndex: 0,
    questionCount: 0,
  });
  
  const getQuizStorageKey = (subjectId: number, identity: StudentDataForm) =>
    `${QUIZ_AUTOSAVE_PREFIX}:${subjectId}:${identity.nis}:${identity.class}`;

  const logQuizDiagnostic = React.useCallback((type: string, details: Record<string, unknown> = {}) => {
    const context = diagnosticContextRef.current;
    appendQuizDiagnosticEntry({
      at: new Date().toISOString(),
      type,
      sessionId: diagnosticSessionRef.current,
      step: context.step,
      subjectId: context.subjectId,
      currentIndex: context.currentIndex,
      questionCount: context.questionCount,
      details,
    });
  }, []);

  const shuffleArray = <T,>(items: T[]) => {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const randomizeQuestions = (rawQuestions: Question[]): QuizQuestion[] => {
    const randomizedQuestions = shuffleArray(rawQuestions).map((q) => {
      const optionOrder = shuffleArray(q.options.map((_, idx) => idx));
      return {
        ...q,
        options: optionOrder.map((idx) => q.options[idx]),
        optionOrder,
      };
    });
    return randomizedQuestions;
  };

  const getDisplayIndexFromAnswer = (question: QuizQuestion, answerIndex: number) => {
    const displayIndex = question.optionOrder.findIndex((originalIdx) => originalIdx === answerIndex);
    return displayIndex > -1 ? displayIndex : null;
  };

  const getQuestionByIndex = (items: QuizQuestion[], index: number) => {
    if (index < 0 || index >= items.length) return null;
    return items[index];
  };

  const buildQuestionsFromAutosave = (
    rawQuestions: Question[],
    questionStates: QuizAutosaveQuestionState[]
  ): QuizQuestion[] => {
    const rawById = new Map(rawQuestions.map((question) => [question.id, question]));
    return questionStates
      .map((state) => {
        const sourceQuestion = rawById.get(state.id);
        if (!sourceQuestion) return null;

        const normalizedOrder = state.optionOrder.filter(
          (index) => index >= 0 && index < sourceQuestion.options.length
        );

        if (normalizedOrder.length !== sourceQuestion.options.length) {
          return {
            ...sourceQuestion,
            optionOrder: sourceQuestion.options.map((_, index) => index),
          };
        }

        return {
          ...sourceQuestion,
          options: normalizedOrder.map((index) => sourceQuestion.options[index]),
          optionOrder: normalizedOrder,
        };
      })
      .filter((question): question is QuizQuestion => question !== null);
  };

  const saveQuizAutosave = (
    subjectId: number,
    identity: StudentDataForm,
    payload: QuizAutosavePayload
  ) => {
    try {
      localStorage.setItem(getQuizStorageKey(subjectId, identity), JSON.stringify(payload));
    } catch (error) {
      console.error("Failed to save quiz autosave", error);
    }
  };

  const clearQuizAutosave = (subjectId?: number, identity?: StudentDataForm) => {
    if (subjectId && identity) {
      localStorage.removeItem(getQuizStorageKey(subjectId, identity));
      return;
    }
    Object.keys(localStorage)
      .filter((key) => key.startsWith(`${QUIZ_AUTOSAVE_PREFIX}:`))
      .forEach((key) => localStorage.removeItem(key));
  };

  const fetchSubjects = async () => {
    try {
      const res = await fetch('/api/subjects');
      const data = await res.json();
      setSubjects(data);
    } catch (err) {
      console.error("Failed to fetch subjects", err);
    }
  };

  // Fetch subjects
  useEffect(() => {
    diagnosticContextRef.current = {
      step,
      subjectId: selectedSubject?.id ?? null,
      currentIndex,
      questionCount: questions.length,
    };
  }, [step, selectedSubject, currentIndex, questions.length]);

  useEffect(() => {
    logQuizDiagnostic('app_ready', {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    });
  }, [logQuizDiagnostic]);

  useEffect(() => {
    const handleRuntimeError = (event: ErrorEvent) => {
      logQuizDiagnostic('window_error', {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      logQuizDiagnostic('unhandled_rejection', {
        reason: String(event.reason),
      });
    };

    window.addEventListener('error', handleRuntimeError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleRuntimeError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [logQuizDiagnostic]);

  useEffect(() => {
    fetchSubjects();
  }, []);

  // Timer logic
  useEffect(() => {
    if (step === 'quiz' && !isDisqualified) {
      const activeQuestion = getQuestionByIndex(questions, currentIndex);
      if (!activeQuestion) {
        logQuizDiagnostic('timer_missing_question', {
          reason: 'active-question-not-found',
        });
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }

      if (completedIndices.has(currentIndex)) {
        logQuizDiagnostic('timer_review_mode', {
          questionId: activeQuestion.id,
        });
        setTimeLeft(0);
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }

      logQuizDiagnostic('question_activated', {
        questionId: activeQuestion.id,
      });
      setTimeLeft(MIN_TIME_PER_QUESTION);
      if (timerRef.current) clearInterval(timerRef.current);
      
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 0) return 0;
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentIndex, step, isDisqualified, completedIndices, questions]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      isPageUnloadingRef.current = true;
      logQuizDiagnostic('before_unload');
    };

    const handlePageShow = () => {
      isPageUnloadingRef.current = false;
      logQuizDiagnostic('page_show');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  // Anti-cheat: Detect tab switching
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && step === 'quiz' && !isPageUnloadingRef.current) {
        logQuizDiagnostic('quiz_disqualified_visibility_change');
        if (selectedSubject) {
          clearQuizAutosave(selectedSubject.id, studentData);
        }
        setLastAutosaveAt(null);
        setQuestions([]);
        setUserAnswers([]);
        setCompletedIndices(new Set());
        setSelectedOption(null);
        setIsDisqualified(true);
        setStep('result');
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [step, selectedSubject, studentData]);

  // Auto-save jawaban selama kuis berjalan
  useEffect(() => {
    if (step !== 'quiz' || isDisqualified || !selectedSubject || questions.length === 0) return;
    const payload = {
      subjectId: selectedSubject.id,
      studentData,
      questionStates: questions.map((question) => ({
        id: question.id,
        optionOrder: question.optionOrder,
      })),
      currentIndex,
      completedIndices: Array.from(completedIndices),
      userAnswers,
      draftSelectedOption: selectedOption,
    };
    saveQuizAutosave(selectedSubject.id, studentData, payload);
    setLastAutosaveAt(
      new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  }, [step, isDisqualified, selectedSubject, studentData, questions, currentIndex, completedIndices, userAnswers, selectedOption]);

  useEffect(() => {
    if (step !== 'quiz' || questions.length === 0) return;
    if (currentIndex < questions.length) return;

    const safeIndex = questions.length - 1;
    logQuizDiagnostic('current_index_corrected', {
      previousIndex: currentIndex,
      safeIndex,
    });
    const safeQuestion = questions[safeIndex];
    const safeAnswer = userAnswers.find((answer) => answer.id === safeQuestion.id);
    setCurrentIndex(safeIndex);
    setSelectedOption(
      safeAnswer ? getDisplayIndexFromAnswer(safeQuestion, safeAnswer.selectedIndex) : null
    );
  }, [step, questions, currentIndex, userAnswers]);

  const handleStartSetup = () => {
    if (studentData.name && studentData.nis && studentData.class) {
      diagnosticSessionRef.current = `quiz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      logQuizDiagnostic('student_setup_complete', {
        class: studentData.class,
        nis: studentData.nis,
      });
      setStep('subject_selection');
    }
  };

  const handleSelectSubject = (subject: Subject) => {
    diagnosticSessionRef.current = `quiz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    logQuizDiagnostic('subject_selected', {
      subjectId: subject.id,
      subjectName: subject.name,
    });
    setSelectedSubject(subject);
    setIsLoading(true);
    setIsDisqualified(false);
    setQuizResult(null);
    setCurrentIndex(0);
    setSelectedOption(null);
    setCompletedIndices(new Set());
    setUserAnswers([]);
    setLastAutosaveAt(null);
    fetch(`/api/questions/${subject.id}`)
      .then(res => res.json())
      .then(data => {
        if (data.length === 0) {
          logQuizDiagnostic('subject_has_no_questions', {
            subjectId: subject.id,
          });
          alert("Mata pelajaran ini belum memiliki soal.");
          setIsLoading(false);
          return;
        }

        const randomized = randomizeQuestions(data as Question[]);
        const savedRaw = localStorage.getItem(getQuizStorageKey(subject.id, studentData));

        if (savedRaw) {
          try {
            const saved = JSON.parse(savedRaw) as QuizAutosavePayload;
            const canRestore = saved.subjectId === subject.id
              && saved.studentData.nis === studentData.nis
              && Array.isArray(saved.questionStates)
              && saved.questionStates.length > 0
              && saved.questionStates.every((q) => Array.isArray(q.optionOrder));

            if (canRestore) {
              const restoredQuestions = buildQuestionsFromAutosave(data as Question[], saved.questionStates);
              if (restoredQuestions.length === 0) {
                throw new Error("Saved quiz questions could not be restored");
              }
              const restoredIndex = Math.min(saved.currentIndex ?? 0, restoredQuestions.length - 1);
              const restoredAnswers = Array.isArray(saved.userAnswers) ? saved.userAnswers : [];
              const restoredCompleted = new Set(saved.completedIndices ?? []);
              const currentQuestion = restoredQuestions[restoredIndex];
              const currentAnswer = restoredAnswers.find(a => a.id === currentQuestion?.id);
              setQuestions(restoredQuestions);
              setCurrentIndex(restoredIndex);
              setUserAnswers(restoredAnswers);
              setCompletedIndices(restoredCompleted);
              setSelectedOption(
                currentQuestion
                  ? currentAnswer
                    ? getDisplayIndexFromAnswer(currentQuestion, currentAnswer.selectedIndex)
                    : saved.draftSelectedOption ?? null
                  : null
              );
              setLastAutosaveAt(
                new Date().toLocaleTimeString('id-ID', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              );
              logQuizDiagnostic('quiz_restored', {
                restoredQuestions: restoredQuestions.length,
                restoredIndex,
                restoredAnswers: restoredAnswers.length,
                restoredCompleted: restoredCompleted.size,
              });
              setStep('quiz');
              setIsLoading(false);
              return;
            }
          } catch (error) {
            logQuizDiagnostic('quiz_restore_failed', {
              message: error instanceof Error ? error.message : 'unknown',
            });
            localStorage.removeItem(getQuizStorageKey(subject.id, studentData));
          }
        }

        setQuestions(randomized);
        logQuizDiagnostic('quiz_started_fresh', {
          questionCount: randomized.length,
        });
        setStep('quiz');
        setIsLoading(false);
      })
      .catch((error) => {
        logQuizDiagnostic('question_fetch_failed', {
          message: error instanceof Error ? error.message : 'unknown',
          subjectId: subject.id,
        });
        setIsLoading(false);
        alert("Gagal mengambil soal. Coba lagi.");
      });
  };

  const handleNext = async () => {
    const currentQuestion = getQuestionByIndex(questions, currentIndex);
    if (!currentQuestion) {
      console.error("Missing current question during next navigation", { currentIndex, total: questions.length });
      logQuizDiagnostic('next_missing_question', {
        currentIndex,
        total: questions.length,
      });
      return;
    }
    if (selectedOption === null) return;
    if (timeLeft > 0) return;

    const selectedOriginalIndex = currentQuestion.optionOrder[selectedOption] ?? selectedOption;
    const existingAnswerIndex = userAnswers.findIndex(a => a.id === currentQuestion.id);
    let newAnswers = [...userAnswers];
    if (existingAnswerIndex > -1) {
      newAnswers[existingAnswerIndex] = { id: currentQuestion.id, selectedIndex: selectedOriginalIndex };
    } else {
      newAnswers.push({ id: currentQuestion.id, selectedIndex: selectedOriginalIndex });
    }
    setUserAnswers(newAnswers);
    
    setCompletedIndices(prev => new Set(prev).add(currentIndex));

    if (currentIndex < questions.length - 1) {
      const nextIndex = currentIndex + 1;
      logQuizDiagnostic('question_next', {
        fromIndex: currentIndex,
        toIndex: nextIndex,
        questionId: currentQuestion.id,
      });
      setCurrentIndex(nextIndex);
      const nextAnswer = newAnswers.find(a => a.id === questions[nextIndex].id);
      setSelectedOption(nextAnswer ? getDisplayIndexFromAnswer(questions[nextIndex], nextAnswer.selectedIndex) : null);
    } else {
      logQuizDiagnostic('quiz_submit_started', {
        answerCount: newAnswers.length,
      });
      setIsLoading(true);
      try {
        const res = await fetch(`/api/submit/${selectedSubject?.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: newAnswers, studentData })
        });
        const data = await res.json();
        if (selectedSubject) {
          clearQuizAutosave(selectedSubject.id, studentData);
        }
        setLastAutosaveAt(null);
        setQuizResult(data);
        logQuizDiagnostic('quiz_submit_succeeded', {
          score: data?.score,
          total: data?.total,
        });
        setStep('result');
      } catch (err) {
        console.error("Submission failed", err);
        logQuizDiagnostic('quiz_submit_failed', {
          message: err instanceof Error ? err.message : 'unknown',
        });
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handlePrev = () => {
    const currentQuestion = getQuestionByIndex(questions, currentIndex);
    if (currentIndex > 0 && currentQuestion) {
      if (selectedOption !== null) {
        const selectedOriginalIndex = currentQuestion.optionOrder[selectedOption] ?? selectedOption;
        const existingAnswerIndex = userAnswers.findIndex(a => a.id === currentQuestion.id);
        let newAnswers = [...userAnswers];
        if (existingAnswerIndex > -1) {
          newAnswers[existingAnswerIndex] = { id: currentQuestion.id, selectedIndex: selectedOriginalIndex };
        } else {
          newAnswers.push({ id: currentQuestion.id, selectedIndex: selectedOriginalIndex });
        }
        setUserAnswers(newAnswers);
      }

      const prevIndex = currentIndex - 1;
      logQuizDiagnostic('question_prev', {
        fromIndex: currentIndex,
        toIndex: prevIndex,
        questionId: currentQuestion.id,
      });
      setCurrentIndex(prevIndex);
      const prevAnswer = userAnswers.find(a => a.id === questions[prevIndex].id);
      setSelectedOption(prevAnswer ? getDisplayIndexFromAnswer(questions[prevIndex], prevAnswer.selectedIndex) : null);
    }
  };

  // --- ADMIN LOGIC ---
  const handleAdminLogin = async () => {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword })
    });
    const data = await res.json();
    if (data.success) {
      setAdminToken(data.token);
      localStorage.setItem('adminToken', data.token);
      setStep('admin_dashboard');
      fetchAdminResults(data.token);
    } else {
      alert(data.message);
    }
  };

  const fetchAdminResults = async (token: string) => {
    const res = await fetch('/api/admin/results', {
      headers: { 'Authorization': token }
    });
    const data = await res.json();
    setAdminResults(data);
  };

  const handleAddSubject = async () => {
    if (!newSubjectName) return;
    setIsAdminLoading(true);
    try {
      const res = await fetch('/api/admin/subjects', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': adminToken!
        },
        body: JSON.stringify({ name: newSubjectName })
      });
      const data = await res.json();
      if (data.success) {
        await fetchSubjects();
        setNewSubjectName('');
        alert("Mata pelajaran berhasil ditambahkan!");
      } else {
        alert("Gagal menambahkan mata pelajaran: " + (data.message || "Terjadi kesalahan"));
      }
    } catch (err) {
      alert("Terjadi kesalahan jaringan.");
    } finally {
      setIsAdminLoading(false);
    }
  };

  const handleDeleteSubject = async (subject: Subject) => {
    if (!confirm(`Hapus mata pelajaran "${subject.name}" beserta semua soal dan hasil ujian?`)) return;
    setDeletingSubjectId(subject.id);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`/api/admin/subjects/${subject.id}/delete`, {
        method: 'POST',
        headers: { 'Authorization': adminToken! },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.success) {
        await fetchSubjects();
        if (selectedSubject?.id === subject.id) {
          setSelectedSubject(null);
          setAdminQuestions([]);
          setBulkQuestions([]);
        }
        alert("Mata pelajaran berhasil dihapus.");
      } else {
        alert("Gagal menghapus mata pelajaran: " + (data.message || "Terjadi kesalahan"));
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        alert("Proses hapus terlalu lama. Coba lagi.");
      } else {
        alert("Terjadi kesalahan saat menghapus mata pelajaran.");
      }
    } finally {
      clearTimeout(timeout);
      setDeletingSubjectId(null);
    }
  };

  const handleAddQuestion = async () => {
    if (!selectedSubject) {
      alert("Silakan pilih mata pelajaran terlebih dahulu!");
      return;
    }
    if (!newQuestion.question) {
      alert("Teks pertanyaan tidak boleh kosong!");
      return;
    }
    
    setIsAdminLoading(true);
    try {
      const res = await fetch('/api/admin/questions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': adminToken!
        },
        body: JSON.stringify({ 
          subject_id: selectedSubject.id,
          ...newQuestion
        })
      });
      const data = await res.json();
      if (data.success) {
        alert("Soal berhasil ditambahkan!");
        setNewQuestion({ question: '', image: '', options: ['', '', '', '', ''], answer: 0 });
        fetchAdminQuestions(selectedSubject.id);
      } else {
        alert("Gagal menambahkan soal: " + (data.message || "Terjadi kesalahan"));
      }
    } catch (err) {
      console.error("Error adding question:", err);
      alert("Terjadi kesalahan jaringan atau server.");
    } finally {
      setIsAdminLoading(false);
    }
  };

  const handleLogout = () => {
    setAdminToken(null);
    localStorage.removeItem('adminToken');
    setStep('setup');
  };

  const handleBulkFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingBulk(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = result.value;
      
      // Parsing logic for common question format
      // Expected format:
      // 1. Question text?
      // A. Option 1
      // B. Option 2
      // C. Option 3
      // D. Option 4
      // E. Option 5
      // Kunci: A
      
      const normalizedText = text
        .replace(/\r/g, '\n')
        .replace(/\u00A0/g, ' ');

      const lines = normalizedText
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);
      const parsedQuestions: any[] = [];
      let currentQ: any = null;
      let currentOptionIndex: number | null = null;

      lines.forEach(line => {
        const cleanLine = line
          .replace(/^[\u2022\-*]+\s*/, '')
          .replace(/\s+/g, ' ')
          .trim();

        // Check if line is a question (starts with number followed by dot)
        const qMatch = cleanLine.match(/^(\d+)[\.\)]\s*(.+)$/);
        if (qMatch) {
          if (currentQ) parsedQuestions.push(currentQ);
          currentQ = { question: qMatch[2], options: [], answer: 0 };
          currentOptionIndex = null;
          return;
        }

        // Check if line is an option (A. / A) / A: / A -)
        const oMatch = cleanLine.match(/^([A-E])(?:\s*[\.\)\:\-])\s*(.+)$/i);
        if (oMatch && currentQ) {
          const idx = oMatch[1].toUpperCase().charCodeAt(0) - 65;
          currentQ.options[idx] = oMatch[2];
          currentOptionIndex = idx;
          return;
        }

        // Check if line is the answer key (Kunci / Kunci Jawaban / Jawaban / Answer / Key)
        const aMatch = cleanLine.match(/^(?:kunci(?:\s*jawaban)?|jawaban(?:\s*benar)?|ans|answer|key)\s*[:=\-]?\s*([A-E])(?:[\.\)]|\b)/i);
        if (aMatch && currentQ) {
          currentQ.answer = aMatch[1].toUpperCase().charCodeAt(0) - 65;
          currentOptionIndex = null;
          return;
        }

        // Continuation line: append to the active option or question
        if (currentQ) {
          if (currentOptionIndex !== null && currentQ.options[currentOptionIndex]) {
            currentQ.options[currentOptionIndex] = `${currentQ.options[currentOptionIndex]} ${cleanLine}`.trim();
          } else {
            currentQ.question = `${currentQ.question} ${cleanLine}`.trim();
          }
        }
      });

      if (currentQ) parsedQuestions.push(currentQ);
      
      // Filter out incomplete questions
      const validQuestions = parsedQuestions.filter(q => {
        const optionCount = (q.options || []).filter((opt: string) => typeof opt === 'string' && opt.trim().length > 0).length;
        return Boolean(q.question?.trim()) && optionCount >= 2;
      });

      setBulkQuestions(validQuestions);
      if (validQuestions.length === 0) {
        alert("Tidak ada soal yang terdeteksi. Cek format dokumen: 1. Soal, A. Opsi, Kunci Jawaban: A");
      } else {
        alert(`Berhasil mengekstrak ${validQuestions.length} soal. Silakan tinjau dan simpan.`);
      }
    } catch (err) {
      console.error("Error parsing Word file:", err);
      alert("Gagal membaca file Word. Pastikan formatnya benar.");
    } finally {
      setIsUploadingBulk(false);
    }
  };

  const handleSaveBulk = async () => {
    if (!selectedSubject) {
      alert("Pilih mata pelajaran terlebih dahulu!");
      return;
    }
    if (bulkQuestions.length === 0) return;

    setIsAdminLoading(true);
    try {
      const preparedQuestions = bulkQuestions.map(q => {
        const finalOptions = [...q.options];
        while (finalOptions.length < 5) finalOptions.push("-");
        return {
          question: q.question,
          options: finalOptions,
          answer: q.answer
        };
      });

      const res = await fetch('/api/admin/questions/bulk', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': adminToken!
        },
        body: JSON.stringify({ 
          subject_id: selectedSubject.id,
          questions: preparedQuestions
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(`Berhasil menyimpan ${data.count} soal.`);
        setBulkQuestions([]);
      } else {
        alert("Gagal menyimpan soal: " + data.message);
      }
    } catch (err) {
      alert("Terjadi kesalahan saat menyimpan soal.");
    } finally {
      setIsAdminLoading(false);
    }
  };

  const handleUpdateSchedule = async () => {
    if (!editingSchedule) return;
    setIsAdminLoading(true);
    try {
      const res = await fetch(`/api/admin/subjects/${editingSchedule.id}/schedule`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': adminToken!
        },
        body: JSON.stringify({ 
          start_time: editingSchedule.start, 
          end_time: editingSchedule.end 
        })
      });
      const data = await res.json();
      if (data.success) {
        setSubjects(subjects.map(s => s.id === editingSchedule.id ? { ...s, start_time: editingSchedule.start, end_time: editingSchedule.end } : s));
        setEditingSchedule(null);
        alert("Jadwal berhasil diperbarui!");
      }
    } catch (err) {
      alert("Gagal memperbarui jadwal.");
    } finally {
      setIsAdminLoading(false);
    }
  };

  const isSubjectActive = (subject: Subject) => {
    if (!subject.start_time || !subject.end_time) return true; // No schedule means always open
    const now = new Date();
    const start = new Date(subject.start_time);
    const end = new Date(subject.end_time);
    return now >= start && now <= end;
  };

  const formatDateTime = (isoString?: string) => {
    if (!isoString) return "Belum diatur";
    return new Date(isoString).toLocaleString('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isEditing: boolean = false) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (isEditing && editingQuestion) {
          setEditingQuestion({ ...editingQuestion, image: reader.result as string });
        } else {
          setNewQuestion({ ...newQuestion, image: reader.result as string });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const fetchAdminQuestions = async (subjectId: number) => {
    if (!adminToken) return;
    try {
      const res = await fetch(`/api/admin/questions/${subjectId}`, {
        headers: { 'Authorization': adminToken }
      });
      const data = await res.json();
      setAdminQuestions(data);
    } catch (err) {
      console.error("Failed to fetch questions", err);
    }
  };

  useEffect(() => {
    if (adminView === 'questions' && selectedSubject) {
      fetchAdminQuestions(selectedSubject.id);
    }
  }, [adminView, selectedSubject]);

  const handleUpdateQuestion = async () => {
    if (!editingQuestion) return;
    setIsAdminLoading(true);
    try {
      const res = await fetch(`/api/admin/questions/${editingQuestion.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': adminToken!
        },
        body: JSON.stringify({
          question: editingQuestion.question,
          image: editingQuestion.image,
          options: editingQuestion.options,
          answer: editingQuestion.answer
        })
      });
      const data = await res.json();
      if (data.success) {
        alert("Soal berhasil diperbarui!");
        setEditingQuestion(null);
        if (selectedSubject) fetchAdminQuestions(selectedSubject.id);
      }
    } catch (err) {
      alert("Gagal memperbarui soal.");
    } finally {
      setIsAdminLoading(false);
    }
  };

  const handleDeleteQuestion = async (id: number) => {
    if (!confirm("Hapus soal ini?")) return;
    try {
      const res = await fetch(`/api/admin/questions/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': adminToken! }
      });
      const data = await res.json();
      if (data.success) {
        if (selectedSubject) fetchAdminQuestions(selectedSubject.id);
      }
    } catch (err) {
      alert("Gagal menghapus soal.");
    }
  };

  const handleExportResultsBySubject = (subjectName: string, results: StudentResult[]) => {
    if (results.length === 0) return;

    const rows = results.map((res, idx) => ({
      No: idx + 1,
      'Nama Siswa': res.student_name,
      NIS: res.nis,
      Kelas: res.class,
      'Mata Pelajaran': res.subject_name,
      Nilai: res.score,
      'Jawaban Benar': res.correct_count,
      'Total Soal': res.total_questions,
      'Waktu Selesai': new Date(res.timestamp).toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const columnWidths = [
      { wch: 6 },
      { wch: 28 },
      { wch: 16 },
      { wch: 16 },
      { wch: 24 },
      { wch: 10 },
      { wch: 14 },
      { wch: 12 },
      { wch: 24 },
    ];
    worksheet['!cols'] = columnWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Hasil Ujian');

    const safeSubjectName = subjectName.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
    XLSX.writeFile(workbook, `Hasil_${safeSubjectName}.xlsx`);
  };

  const activeQuestion = getQuestionByIndex(questions, currentIndex);
  const isQuizStateReady = step !== 'quiz' || (questions.length > 0 && activeQuestion !== null);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100">
      <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12">
        {/* Header */}
        <header className="text-center mb-8 sm:mb-12">
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 mb-2"
          >
            Sistem Ujian Sekolah
          </motion.h1>
          <p className="text-slate-500 text-sm sm:text-base">Penilaian Akhir Tahun - Tahun Ajaran 2025/2026</p>
        </header>

        <AnimatePresence mode="wait">
          {step === 'setup' && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8"
            >
              <div className="flex items-center gap-3 mb-6 text-indigo-600">
                <User size={24} />
                <h2 className="text-xl font-semibold">Data Peserta Ujian</h2>
              </div>

              <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-8 rounded-r-lg">
                <div className="flex gap-3">
                  <AlertTriangle className="text-amber-500 shrink-0" size={20} />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Aturan Penting:</p>
                    <ul className="text-xs text-amber-700 list-disc ml-4 mt-1 space-y-1">
                      <li>Setiap soal wajib dikerjakan minimal selama <strong>{MIN_TIME_PER_QUESTION} detik</strong>.</li>
                      <li>Dilarang meninggalkan halaman ujian (otomatis diskualifikasi).</li>
                      <li>Jawaban akan divalidasi oleh server secara real-time.</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nama Lengkap</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none text-base"
                    placeholder="Masukkan nama sesuai absen"
                    value={studentData.name}
                    onChange={e => setStudentData({...studentData, name: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">NIS</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none text-base"
                      placeholder="Nomor Induk"
                      value={studentData.nis}
                      onChange={e => setStudentData({...studentData, nis: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Kelas</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none text-base"
                      placeholder="Contoh: X RPL"
                      value={studentData.class}
                      onChange={e => setStudentData({...studentData, class: e.target.value})}
                    />
                  </div>
                </div>
              </div>

              <button 
                onClick={handleStartSetup}
                disabled={!studentData.name || !studentData.nis || !studentData.class}
                className="w-full mt-8 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold py-4 rounded-xl transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 text-lg"
              >
                Pilih Mata Pelajaran <ChevronRight size={20} />
              </button>

              <div className="mt-8 pt-6 border-t border-slate-100 text-center">
                <button 
                  onClick={() => setStep(adminToken ? 'admin_dashboard' : 'admin_login')}
                  className="text-slate-400 hover:text-indigo-600 text-sm flex items-center justify-center gap-2 mx-auto transition-colors"
                >
                  <Settings size={16} /> Akses Admin
                </button>
              </div>
            </motion.div>
          )}

          {step === 'subject_selection' && (
            <motion.div
              key="subject_selection"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8"
            >
              <div className="flex items-center gap-3 mb-6 text-indigo-600">
                <BookOpen size={24} />
                <h2 className="text-xl font-semibold">Pilih Mata Pelajaran</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {subjects.map(subject => {
                  const active = isSubjectActive(subject);
                  return (
                    <button
                      key={subject.id}
                      onClick={() => active && handleSelectSubject(subject)}
                      disabled={!active}
                      className={`p-6 rounded-2xl border transition-all text-left group relative overflow-hidden ${
                        active 
                        ? 'border-slate-200 hover:border-indigo-600 hover:bg-indigo-50' 
                        : 'border-slate-100 bg-slate-50 opacity-75 cursor-not-allowed'
                      }`}
                    >
                      {!active && (
                        <div className="absolute top-2 right-2 text-slate-400">
                          <Lock size={16} />
                        </div>
                      )}
                      <div className={`font-bold text-lg ${active ? 'group-hover:text-indigo-700' : 'text-slate-400'}`}>
                        {subject.name}
                      </div>
                      {subject.start_time && (
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center gap-2 text-[10px] text-slate-400">
                            <Calendar size={12} /> {formatDateTime(subject.start_time)}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400">
                            <Clock size={12} /> Selesai: {formatDateTime(subject.end_time)}
                          </div>
                        </div>
                      )}
                      <div className={`text-sm mt-3 font-medium ${active ? 'text-indigo-600' : 'text-slate-400'}`}>
                        {active ? 'Mulai Ujian Sekarang' : 'Belum Waktunya Ujian'}
                      </div>
                    </button>
                  );
                })}
              </div>

              <button 
                onClick={() => setStep('setup')}
                className="mt-8 text-slate-500 hover:text-slate-700 flex items-center gap-2 font-medium"
              >
                <ChevronLeft size={20} /> Kembali ke Data Diri
              </button>
            </motion.div>
          )}

          {step === 'quiz' && isQuizStateReady && activeQuestion && (
            <QuizRenderBoundary
              resetKey={`${selectedSubject?.id || 'none'}:${currentIndex}:${activeQuestion.id}`}
              onDownloadDiagnostics={downloadQuizDiagnostics}
              onRenderError={(error, errorInfo) => {
                logQuizDiagnostic('quiz_render_error', {
                  message: error.message,
                  stack: error.stack,
                  componentStack: errorInfo.componentStack,
                  questionId: activeQuestion.id,
                });
              }}
            >
              <motion.div
                key="quiz"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4 sm:y-6"
              >
                {/* Progress & Timer */}
                <div className="flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                  <div className="flex items-center gap-2 text-slate-500 text-xs sm:text-sm font-medium">
                    <BookOpen size={18} />
                    {selectedSubject?.name} - Soal {currentIndex + 1} / {questions.length}
                  </div>
                  <div className={`flex items-center gap-2 px-3 sm:px-4 py-1 rounded-full text-xs sm:text-sm font-bold ${timeLeft > 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                    <Timer size={16} />
                    {timeLeft > 0 ? `Tunggu ${timeLeft}s` : 'Siap Lanjut'}
                  </div>
                </div>
                <div className="mt-2 text-right text-[11px] text-slate-400">
                  {lastAutosaveAt ? `Progress tersimpan otomatis • ${lastAutosaveAt}` : 'Progress tersimpan otomatis aktif'}
                </div>

                {/* Question Card */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
                  <div className="mb-6 sm:mb-8">
                    {activeQuestion.image && (
                      <div className="mb-6 rounded-xl overflow-hidden border border-slate-100 bg-slate-50 flex justify-center">
                        <img 
                          src={activeQuestion.image} 
                          alt="Question" 
                          className="max-h-64 object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                    <div className="text-lg sm:text-xl font-medium leading-relaxed text-slate-800">
                      <FormattedText text={activeQuestion.question} />
                    </div>
                  </div>

                  <div className="space-y-3">
                    {activeQuestion.options.map((option, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedOption(idx)}
                        className={`w-full text-left p-4 rounded-xl border transition-all flex items-center gap-3 sm:gap-4 ${
                          selectedOption === idx 
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600' 
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold shrink-0 text-sm ${
                          selectedOption === idx ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <div className="text-sm sm:text-base flex-1">
                          <FormattedText text={option} />
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-[10px] sm:text-xs text-slate-400 italic text-center sm:text-left">
                      {completedIndices.has(currentIndex) 
                        ? "* Meninjau soal: Aturan waktu tidak berlaku." 
                        : `* Tombol selanjutnya akan aktif setelah ${MIN_TIME_PER_QUESTION} detik pengerjaan.`}
                    </p>
                    <div className="flex w-full sm:w-auto gap-3">
                      {currentIndex > 0 && (
                        <button
                          onClick={handlePrev}
                          className="flex-1 sm:flex-none border border-slate-200 text-slate-600 font-semibold px-6 py-4 sm:py-3 rounded-xl transition-all hover:bg-slate-50"
                        >
                          Kembali
                        </button>
                      )}
                      <button
                        onClick={handleNext}
                        disabled={selectedOption === null || timeLeft > 0 || isLoading}
                        className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold px-8 py-4 sm:py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                      >
                        {isLoading ? <Loader2 className="animate-spin" /> : (currentIndex === questions.length - 1 ? 'Selesai' : 'Selanjutnya')}
                        <ChevronRight size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </QuizRenderBoundary>
          )}

          {step === 'quiz' && !isQuizStateReady && (
            <motion.div
              key="quiz-recovering"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center"
            >
              <Loader2 className="animate-spin text-indigo-600 mx-auto mb-4" size={36} />
              <p className="text-slate-600">Memulihkan sesi ujian yang tersimpan...</p>
            </motion.div>
          )}

          {step === 'result' && (
            <motion.div
              key="result"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8 text-center"
            >
              {isDisqualified ? (
                <div className="py-8">
                  <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <XCircle size={48} />
                  </div>
                  <h2 className="text-2xl font-bold text-red-600 mb-2">Diskualifikasi!</h2>
                  <p className="text-slate-500 max-w-sm mx-auto text-sm sm:text-base">
                    Anda terdeteksi meninggalkan halaman ujian. Nilai Anda tidak dapat diproses.
                  </p>
                </div>
              ) : quizResult ? (
                <>
                  <div className="mb-8">
                    <div className="text-slate-500 text-sm mb-1">Nilai Akhir - {selectedSubject?.name}</div>
                    <div className="text-6xl sm:text-7xl font-black text-indigo-600">{quizResult.score}</div>
                    <div className="text-slate-400 text-xs sm:text-sm mt-2">
                      Benar {quizResult.correctCount} dari {quizResult.total} soal
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-left mb-8">
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Nama Siswa</div>
                      <div className="font-semibold text-sm sm:text-base">{studentData.name}</div>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">NIS / Kelas</div>
                      <div className="font-semibold text-sm sm:text-base">{studentData.nis} / {studentData.class}</div>
                    </div>
                  </div>

                  <div className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-slate-800 text-left border-b pb-2">Tinjauan Jawaban</h3>
                    <div className="max-h-96 overflow-y-auto pr-2 space-y-3">
                      {quizResult.results.map((res, idx) => (
                        <div key={idx} className={`p-4 rounded-xl border text-left ${res.isCorrect ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                          <div className="flex gap-3">
                            {res.isCorrect ? <CheckCircle2 className="text-green-600 shrink-0" size={20} /> : <XCircle className="text-red-600 shrink-0" size={20} />}
                            <div>
                              <p className="text-sm font-medium text-slate-800 mb-2">{res.question}</p>
                              <div className="text-xs space-y-1">
                                <p className={res.isCorrect ? 'text-green-700' : 'text-red-700'}>
                                  Jawaban Anda: {res.options[res.userAnswer]}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                </>
              ) : (
                <div className="py-20 flex flex-col items-center">
                  <Loader2 className="animate-spin text-indigo-600 mb-4" size={40} />
                  <p className="text-slate-500">Mengkalkulasi nilai Anda...</p>
                </div>
              )}
            </motion.div>
          )}

          {step === 'admin_login' && (
            <motion.div
              key="admin_login"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md mx-auto"
            >
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Settings size={32} />
                </div>
                <h2 className="text-2xl font-bold">Login Admin</h2>
                <p className="text-slate-500 text-sm">Masukkan password untuk akses dashboard</p>
              </div>

              <div className="space-y-4">
                <input 
                  type="password" 
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="Password Admin"
                  value={adminPassword}
                  onChange={e => setAdminPassword(e.target.value)}
                />
                <button 
                  onClick={handleAdminLogin}
                  className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 transition-all"
                >
                  Login
                </button>
                <button 
                  onClick={() => setStep('setup')}
                  className="w-full text-slate-400 text-sm font-medium"
                >
                  Batal
                </button>
              </div>
            </motion.div>
          )}

          {step === 'admin_dashboard' && (
            <motion.div
              key="admin_dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
            >
              {/* Admin Sidebar/Nav */}
              <div className="flex flex-col md:flex-row">
                <div className="w-full md:w-64 bg-slate-50 border-r border-slate-200 p-6 space-y-2">
                  <div className="flex items-center gap-3 text-indigo-600 font-bold text-xl mb-8">
                    <LayoutDashboard size={24} /> Admin Panel
                  </div>
                  <button 
                    onClick={() => setAdminView('results')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${adminView === 'results' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-200'}`}
                  >
                    <ClipboardList size={20} /> Hasil Siswa
                  </button>
                  <button 
                    onClick={() => setAdminView('questions')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${adminView === 'questions' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-200'}`}
                  >
                    <BookOpen size={20} /> Kelola Soal
                  </button>
                  <button 
                    onClick={() => setAdminView('schedule')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${adminView === 'schedule' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-200'}`}
                  >
                    <Calendar size={20} /> Jadwal Ujian
                  </button>
                  <div className="pt-8">
                    <button 
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-red-600 hover:bg-red-50 transition-all"
                    >
                      <LogOut size={20} /> Logout
                    </button>
                  </div>
                </div>

                {/* Admin Content Area */}
                <div className="flex-1 p-6 sm:p-8 max-h-[80vh] overflow-y-auto">
                  {adminView === 'schedule' && (
                    <div className="space-y-6">
                      <h3 className="text-2xl font-bold">Pengaturan Jadwal Ujian</h3>
                      <div className="grid grid-cols-1 gap-4">
                        {subjects.map(subject => (
                          <div key={subject.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                              <div className="font-bold text-lg text-slate-800">{subject.name}</div>
                              {editingSchedule?.id === subject.id ? (
                                <div className="flex gap-2">
                                  <button 
                                    onClick={() => setEditingSchedule(null)}
                                    className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-lg"
                                  >
                                    Batal
                                  </button>
                                  <button 
                                    onClick={handleUpdateSchedule}
                                    disabled={isAdminLoading}
                                    className="px-4 py-2 text-sm font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-slate-300"
                                  >
                                    Simpan
                                  </button>
                                </div>
                              ) : (
                                <button 
                                  onClick={() => setEditingSchedule({ 
                                    id: subject.id, 
                                    start: subject.start_time || '', 
                                    end: subject.end_time || '' 
                                  })}
                                  className="px-4 py-2 text-sm font-bold text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-100"
                                >
                                  Edit Jadwal
                                </button>
                              )}
                            </div>

                            {editingSchedule?.id === subject.id ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Waktu Mulai</label>
                                  <input 
                                    type="datetime-local" 
                                    className="w-full px-4 py-2 rounded-xl border border-slate-200 outline-none"
                                    value={editingSchedule.start}
                                    onChange={e => setEditingSchedule({ ...editingSchedule, start: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Waktu Selesai</label>
                                  <input 
                                    type="datetime-local" 
                                    className="w-full px-4 py-2 rounded-xl border border-slate-200 outline-none"
                                    value={editingSchedule.end}
                                    onChange={e => setEditingSchedule({ ...editingSchedule, end: e.target.value })}
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col sm:flex-row gap-6">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
                                    <Calendar size={20} />
                                  </div>
                                  <div>
                                    <div className="text-[10px] text-slate-400 uppercase font-bold">Mulai</div>
                                    <div className="text-sm font-medium">{formatDateTime(subject.start_time)}</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center">
                                    <Clock size={20} />
                                  </div>
                                  <div>
                                    <div className="text-[10px] text-slate-400 uppercase font-bold">Selesai</div>
                                    <div className="text-sm font-medium">{formatDateTime(subject.end_time)}</div>
                                  </div>
                                </div>
                                <div className="flex-1 flex items-center justify-end">
                                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${isSubjectActive(subject) ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                    {isSubjectActive(subject) ? 'Aktif' : 'Tidak Aktif'}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {adminView === 'results' && (
                    <div className="space-y-8">
                      <div className="flex items-center justify-between">
                        <h3 className="text-2xl font-bold">Hasil Pengerjaan Siswa</h3>
                        <button 
                          onClick={() => fetchAdminResults(adminToken!)}
                          className="text-indigo-600 text-sm font-bold flex items-center gap-2"
                        >
                          Refresh Data
                        </button>
                      </div>

                      {Object.entries(groupedResults).map(([subjectName, results]: [string, StudentResult[]]) => (
                        <div key={subjectName} className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                          <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-1.5 h-6 bg-indigo-600 rounded-full"></div>
                              <h4 className="text-lg font-bold text-slate-800">{subjectName}</h4>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold">
                                {results.length} Peserta
                              </span>
                              <button
                                type="button"
                                onClick={() => handleExportResultsBySubject(subjectName, results)}
                                className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                              >
                                <FileSpreadsheet size={14} />
                                Download Excel
                              </button>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="border-b border-slate-50">
                                  <th className="py-4 px-6 text-xs font-bold text-slate-400 uppercase tracking-wider">Siswa</th>
                                  <th className="py-4 px-6 text-xs font-bold text-slate-400 uppercase tracking-wider text-center">Nilai</th>
                                  <th className="py-4 px-6 text-xs font-bold text-slate-400 uppercase tracking-wider">Waktu Selesai</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {results.map(res => (
                                  <tr key={res.id} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="py-4 px-6">
                                      <div className="font-bold text-slate-800">{res.student_name}</div>
                                      <div className="text-xs text-slate-400">{res.nis} - {res.class}</div>
                                    </td>
                                    <td className="py-4 px-6 text-center">
                                      <div className={`text-lg font-black ${res.score >= 75 ? 'text-green-600' : 'text-red-600'}`}>
                                        {res.score}
                                      </div>
                                      <div className="text-[10px] text-slate-400 font-medium">{res.correct_count}/{res.total_questions} Benar</div>
                                    </td>
                                    <td className="py-4 px-6 text-xs text-slate-400">
                                      {new Date(res.timestamp).toLocaleString('id-ID', {
                                        dateStyle: 'medium',
                                        timeStyle: 'short'
                                      })}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}

                      {adminResults.length === 0 && (
                        <div className="text-center py-20 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
                          <ClipboardList className="mx-auto text-slate-300 mb-4" size={48} />
                          <p className="text-slate-500 font-medium">Belum ada hasil pengerjaan yang tersedia.</p>
                        </div>
                      )}
                    </div>
                  )}

                  {adminView === 'questions' && (
                    <div className="space-y-8">
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <h3 className="text-2xl font-bold">Kelola Mata Pelajaran & Soal</h3>
                        <div className="flex gap-2 w-full sm:w-auto">
                          <input 
                            type="text" 
                            className="flex-1 px-4 py-2 rounded-xl border border-slate-200 outline-none text-sm"
                            placeholder="Mata Pelajaran Baru"
                            value={newSubjectName}
                            onChange={e => setNewSubjectName(e.target.value)}
                          />
                          <button 
                            type="button"
                            onClick={handleAddSubject}
                            disabled={isAdminLoading}
                            className="bg-indigo-600 text-white p-2 rounded-xl disabled:bg-slate-300 transition-colors"
                          >
                            {isAdminLoading ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} />}
                          </button>
                        </div>
                      </div>

                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                        <h4 className="font-bold mb-4">Daftar Mata Pelajaran</h4>
                        {subjects.length > 0 ? (
                          <div className="space-y-2">
                            {subjects.map((subject) => (
                              <div key={subject.id} className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
                                <span className="text-sm font-medium text-slate-700">{subject.name}</span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSubject(subject)}
                                  disabled={deletingSubjectId !== null}
                                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:text-slate-300 disabled:hover:bg-transparent"
                                  title={`Hapus ${subject.name}`}
                                >
                                  {deletingSubjectId === subject.id ? (
                                    <Loader2 size={16} className="animate-spin" />
                                  ) : (
                                    <Trash2 size={16} />
                                  )}
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-6 text-slate-400 text-sm">
                            Belum ada mata pelajaran.
                          </div>
                        )}
                      </div>

                      <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100">
                        <h4 className="font-bold mb-4 text-indigo-900">Pilih Mata Pelajaran Target</h4>
                        <select 
                          className="w-full px-4 py-3 rounded-xl border border-indigo-200 outline-none bg-white font-bold text-indigo-900"
                          value={selectedSubject?.id || ""}
                          onChange={e => setSelectedSubject(subjects.find(s => s.id === parseInt(e.target.value)) || null)}
                        >
                          <option value="">-- Pilih Mata Pelajaran --</option>
                          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <p className="mt-2 text-xs text-indigo-500">
                          * Pilih mata pelajaran ini sebelum mengunggah file Word atau menambah soal manual.
                        </p>
                      </div>

                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="font-bold">Upload Soal dari Word (.docx)</h4>
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <AlertTriangle size={14} /> Format: 1. Soal... A. Opsi... Kunci: A
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div className="flex items-center gap-4">
                            <label className="flex-1 cursor-pointer">
                              <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 hover:border-indigo-400 transition-all flex items-center justify-center gap-3 bg-white">
                                <FileUp className="text-slate-400" size={24} />
                                <span className="text-sm text-slate-500">
                                  {isUploadingBulk ? 'Membaca file...' : 'Klik untuk pilih file Word'}
                                </span>
                              </div>
                              <input 
                                type="file" 
                                className="hidden" 
                                accept=".docx"
                                onChange={handleBulkFileChange}
                                disabled={isUploadingBulk || isAdminLoading}
                              />
                            </label>
                          </div>

                          {bulkQuestions.length > 0 && (
                            <div className="space-y-4">
                              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl bg-white p-4 space-y-3">
                                {bulkQuestions.map((q, i) => (
                                  <div key={i} className="text-xs border-b border-slate-50 pb-2 last:border-0">
                                    <div className="font-bold flex gap-2">
                                      <span>{i + 1}.</span>
                                      <span>{q.question}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-4 mt-1 text-slate-500">
                                      {q.options.map((opt: string, j: number) => (
                                        <div key={j} className={q.answer === j ? 'text-green-600 font-bold' : ''}>
                                          {String.fromCharCode(65 + j)}. {opt}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="flex gap-3">
                                <button 
                                  type="button"
                                  onClick={() => setBulkQuestions([])}
                                  className="flex-1 border border-slate-200 text-slate-600 font-bold py-3 rounded-xl hover:bg-slate-100 transition-all"
                                >
                                  Batal
                                </button>
                                <button 
                                  type="button"
                                  onClick={handleSaveBulk}
                                  disabled={isAdminLoading || !selectedSubject}
                                  className="flex-2 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-all disabled:bg-slate-300 flex items-center justify-center gap-2"
                                >
                                  {isAdminLoading ? <Loader2 className="animate-spin" size={20} /> : <FileText size={20} />}
                                  Simpan {bulkQuestions.length} Soal ke {selectedSubject?.name || '...'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                        <h4 className="font-bold mb-4">Tambah Soal Baru (Manual)</h4>
                        <div className="space-y-4">
                          <div className="flex gap-4">
                            <div className="flex-1">
                              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Pertanyaan (Markdown/LaTeX)</label>
                              <textarea 
                                className="w-full px-4 py-2 rounded-xl border border-slate-200 outline-none min-h-30"
                                placeholder="Teks Pertanyaan... Gunakan $...$ untuk Matematika"
                                value={newQuestion.question}
                                onChange={e => setNewQuestion({...newQuestion, question: e.target.value})}
                              />
                            </div>
                            <div className="w-48">
                              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Gambar Soal</label>
                              <div className="relative group">
                                {newQuestion.image ? (
                                  <div className="relative h-32 w-full rounded-xl overflow-hidden border border-slate-200">
                                    <img src={newQuestion.image} className="h-full w-full object-cover" alt="Preview" />
                                    <button 
                                      onClick={() => setNewQuestion({...newQuestion, image: ''})}
                                      className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                ) : (
                                  <label className="h-32 w-full rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400 transition-all bg-white">
                                    <ImageIcon className="text-slate-400 mb-2" size={24} />
                                    <span className="text-xs text-slate-400">Upload Gambar</span>
                                    <input type="file" className="hidden" accept="image/*" onChange={e => handleImageUpload(e)} />
                                  </label>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {newQuestion.options.map((opt, i) => (
                              <div key={i} className="flex gap-2 items-center">
                                <span className="font-bold text-slate-400">{String.fromCharCode(65 + i)}</span>
                                <input 
                                  type="text" 
                                  className="flex-1 px-4 py-2 rounded-xl border border-slate-200 outline-none text-sm"
                                  placeholder={`Opsi ${String.fromCharCode(65 + i)}`}
                                  value={opt}
                                  onChange={e => {
                                    const opts = [...newQuestion.options];
                                    opts[i] = e.target.value;
                                    setNewQuestion({...newQuestion, options: opts});
                                  }}
                                />
                                <input 
                                  type="radio" 
                                  name="correct_answer"
                                  checked={newQuestion.answer === i}
                                  onChange={() => setNewQuestion({...newQuestion, answer: i})}
                                />
                              </div>
                            ))}
                          </div>
                          <button 
                            type="button"
                            onClick={handleAddQuestion}
                            disabled={isAdminLoading || !selectedSubject}
                            className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-all disabled:bg-slate-300 flex items-center justify-center gap-2"
                          >
                            {isAdminLoading ? <Loader2 className="animate-spin" size={20} /> : <Plus size={20} />}
                            Simpan Soal ke {selectedSubject?.name || '...'}
                          </button>
                        </div>
                      </div>
                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                        <h4 className="font-bold mb-4">Daftar Soal Tersimpan</h4>
                        {selectedSubject ? (
                          <div className="space-y-4">
                            {adminQuestions.length > 0 ? (
                              adminQuestions.map((q, idx) => (
                                <div key={q.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                  {editingQuestion?.id === q.id ? (
                                    <div className="space-y-4">
                                      <div className="flex gap-4">
                                        <div className="flex-1">
                                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Pertanyaan (Markdown/LaTeX)</label>
                                          <textarea 
                                            className="w-full px-4 py-2 rounded-xl border border-slate-200 outline-none min-h-25 text-sm"
                                            value={editingQuestion.question}
                                            onChange={e => setEditingQuestion({...editingQuestion, question: e.target.value})}
                                          />
                                        </div>
                                        <div className="w-48">
                                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Gambar</label>
                                          <div className="relative group">
                                            {editingQuestion.image ? (
                                              <div className="relative h-24 w-full rounded-xl overflow-hidden border border-slate-200">
                                                <img src={editingQuestion.image} className="h-full w-full object-cover" alt="Preview" />
                                                <button 
                                                  onClick={() => setEditingQuestion({...editingQuestion, image: ''})}
                                                  className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                  <X size={12} />
                                                </button>
                                              </div>
                                            ) : (
                                              <label className="h-24 w-full rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400 transition-all bg-slate-50">
                                                <ImageIcon className="text-slate-400" size={20} />
                                                <span className="text-[10px] text-slate-400 mt-1">Upload</span>
                                                <input type="file" className="hidden" accept="image/*" onChange={e => handleImageUpload(e, true)} />
                                              </label>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {editingQuestion.options.map((opt: string, i: number) => (
                                          <div key={i} className="flex gap-2 items-center">
                                            <span className="text-xs font-bold text-slate-400">{String.fromCharCode(65 + i)}</span>
                                            <input 
                                              type="text" 
                                              className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 outline-none text-xs"
                                              value={opt}
                                              onChange={e => {
                                                const opts = [...editingQuestion.options];
                                                opts[i] = e.target.value;
                                                setEditingQuestion({...editingQuestion, options: opts});
                                              }}
                                            />
                                            <input 
                                              type="radio" 
                                              checked={editingQuestion.answer === i}
                                              onChange={() => setEditingQuestion({...editingQuestion, answer: i})}
                                            />
                                          </div>
                                        ))}
                                      </div>
                                      <div className="flex gap-2 pt-2">
                                        <button 
                                          onClick={() => setEditingQuestion(null)}
                                          className="flex-1 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-lg"
                                        >
                                          Batal
                                        </button>
                                        <button 
                                          onClick={handleUpdateQuestion}
                                          disabled={isAdminLoading}
                                          className="flex-1 py-2 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-slate-300"
                                        >
                                          Simpan Perubahan
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="flex justify-between gap-4">
                                        <div className="flex-1">
                                          {q.image && (
                                            <div className="mb-3 rounded-lg overflow-hidden border border-slate-100 w-32">
                                              <img src={q.image} alt="Question" className="w-full object-contain" />
                                            </div>
                                          )}
                                          <div className="text-sm font-medium text-slate-800">
                                            <span className="text-slate-400 mr-2">{idx + 1}.</span>
                                            <FormattedText text={q.question} />
                                          </div>
                                        </div>
                                        <div className="flex gap-1 shrink-0">
                                          <button 
                                            onClick={() => setEditingQuestion({...q})}
                                            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                            title="Edit Soal"
                                          >
                                            <Edit3 size={16} />
                                          </button>
                                          <button 
                                            onClick={() => handleDeleteQuestion(q.id)}
                                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            title="Hapus Soal"
                                          >
                                            <Trash2 size={16} />
                                          </button>
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-3">
                                        {q.options.map((opt: string, i: number) => (
                                          <div key={i} className={`text-xs ${q.answer === i ? 'text-green-600 font-bold' : 'text-slate-500'}`}>
                                            {String.fromCharCode(65 + i)}. <FormattedText text={opt} />
                                          </div>
                                        ))}
                                      </div>
                                    </>
                                  )}
                                </div>
                              ))
                            ) : (
                              <div className="text-center py-8 text-slate-400 text-sm">
                                Belum ada soal untuk mata pelajaran ini.
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-center py-8 text-slate-400 text-sm italic">
                            Silakan pilih mata pelajaran di atas untuk melihat daftar soal.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
