import { useState, useEffect } from 'react'

interface Student {
  id: string
  name: string
  phone: string
  grade: string
  enrolledCourse: string
  paymentStatus: string
  tags: string[]
  createdAt: string
}

const PAYMENT_BADGE: Record<string, string> = {
  Paid: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  Unpaid: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  Pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
}

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('whatsy_jwt')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterGrade, setFilterGrade] = useState('')
  const [filterCourse, setFilterCourse] = useState('')
  const [filterPayment, setFilterPayment] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', grade: '', enrolledCourse: '', paymentStatus: 'Pending' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const PAGE_SIZE = 50

  useEffect(() => { fetchStudents(0, true) }, [])

  async function fetchStudents(newOffset = 0, reset = false) {
    reset ? setLoading(true) : setLoadingMore(true)
    try {
      const res = await fetch(`/v1/students?limit=${PAGE_SIZE}&offset=${newOffset}`, { headers: getAuthHeader() })
      if (!res.ok) throw new Error(`[${res.status}]`)
      const data = await res.json() as Student[] | { students: Student[] }
      const page = Array.isArray(data) ? data : (data.students ?? [])
      setStudents(prev => reset ? page : [...prev, ...page])
      setOffset(newOffset + page.length)
      setHasMore(page.length === PAGE_SIZE)
    } catch {
      setError('Failed to load students')
    } finally {
      reset ? setLoading(false) : setLoadingMore(false)
    }
  }

  async function handleAddStudent(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      const res = await fetch('/v1/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(`[${res.status}]`)
      setShowModal(false)
      setForm({ name: '', phone: '', grade: '', enrolledCourse: '', paymentStatus: 'Pending' })
      fetchStudents(0, true)
    } catch {
      setFormError('Failed to save student')
    } finally {
      setSaving(false)
    }
  }

  const grades = [...new Set(students.map(s => s.grade).filter(Boolean))]
  const courses = [...new Set(students.map(s => s.enrolledCourse).filter(Boolean))]

  const filtered = students.filter(s => {
    if (filterGrade && s.grade !== filterGrade) return false
    if (filterCourse && s.enrolledCourse !== filterCourse) return false
    if (filterPayment && s.paymentStatus !== filterPayment) return false
    if (search) {
      const q = search.toLowerCase()
      return s.name.toLowerCase().includes(q) || s.phone.includes(q)
    }
    return true
  })

  const inputCls = 'px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-[#374151] bg-white dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] focus:outline-none focus:ring-2 focus:ring-[#00a884]'
  const modalInputCls = 'w-full px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-[#374151] bg-white dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] focus:outline-none focus:ring-2 focus:ring-[#00a884]'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b141a] flex flex-col">
      {/* Header */}
      <div className="bg-white dark:bg-[#111b21] border-b border-gray-200 dark:border-[#222e35] px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900 dark:text-[#e9edef]">Students</h1>
          <span className="text-sm text-gray-400 dark:text-[#8696a0] bg-gray-100 dark:bg-[#202c33] px-2 py-0.5 rounded-full">
            {filtered.length}
          </span>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#00967a] text-white text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Student
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-[#111b21] border-b border-gray-200 dark:border-[#222e35] px-6 py-3 flex flex-wrap gap-2 shrink-0">
        <input
          type="text"
          placeholder="Search name or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={`${inputCls} w-52`}
        />
        <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} className={inputCls}>
          <option value="">All Grades</option>
          {grades.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={filterCourse} onChange={e => setFilterCourse(e.target.value)} className={inputCls}>
          <option value="">All Courses</option>
          {courses.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)} className={inputCls}>
          <option value="">All Payment</option>
          <option value="Paid">Paid</option>
          <option value="Unpaid">Unpaid</option>
          <option value="Pending">Pending</option>
        </select>
        {(search || filterGrade || filterCourse || filterPayment) && (
          <button
            onClick={() => { setSearch(''); setFilterGrade(''); setFilterCourse(''); setFilterPayment('') }}
            className="px-3 py-1.5 text-sm text-gray-500 dark:text-[#8696a0] hover:text-gray-700 dark:hover:text-[#e9edef] transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-gray-400 dark:text-[#8696a0]">
            <svg className="animate-spin w-5 h-5 text-[#00a884]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading students…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-20 text-red-500">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-[#202c33] flex items-center justify-center">
              <svg className="w-7 h-7 text-gray-400 dark:text-[#8696a0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <p className="text-gray-500 dark:text-[#8696a0]">No students found</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#182229] border-b border-gray-200 dark:border-[#222e35]">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-[#8696a0]">Student</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-[#8696a0]">Grade</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-[#8696a0]">Course</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-[#8696a0]">Payment</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-[#8696a0]">Tags</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#222e35]">
                {filtered.map(student => (
                  <tr key={student.id} className="hover:bg-gray-50 dark:hover:bg-[#182229] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#00a884] flex items-center justify-center text-white font-semibold text-sm shrink-0">
                          {student.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-[#e9edef]">{student.name}</p>
                          <p className="text-gray-400 dark:text-[#8696a0] text-xs">{student.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-[#8696a0]">{student.grade || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-[#8696a0] max-w-[160px] truncate">{student.enrolledCourse || '—'}</td>
                    <td className="px-4 py-3">
                      {student.paymentStatus ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_BADGE[student.paymentStatus] ?? 'bg-gray-100 text-gray-600 dark:bg-[#202c33] dark:text-[#8696a0]'}`}>
                          {student.paymentStatus}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(student.tags ?? []).slice(0, 3).map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 bg-[#00a884]/10 text-[#00a884] rounded text-xs">{tag}</span>
                        ))}
                        {(student.tags ?? []).length > 3 && (
                          <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-[#202c33] text-gray-500 dark:text-[#8696a0] rounded text-xs">+{student.tags.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => { window.location.href = `/?conv=${encodeURIComponent(student.phone)}` }}
                        className="px-3 py-1 rounded-lg text-xs font-medium bg-[#00a884] hover:bg-[#00967a] text-white transition-colors"
                      >
                        Open Chat
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-[#222e35]">
              <span className="text-sm text-gray-400 dark:text-[#8696a0]">
                Showing {filtered.length} of {students.length} students
              </span>
              {hasMore && (
                <button
                  onClick={() => fetchStudents(offset)}
                  disabled={loadingMore}
                  className="bg-gray-100 dark:bg-[#202c33] hover:bg-gray-200 dark:hover:bg-[#2a3942] text-gray-700 dark:text-[#e9edef] px-4 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Student Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-[#222e35]">
              <h2 className="text-lg font-bold text-gray-900 dark:text-[#e9edef]">Add Student</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 dark:text-[#8696a0] hover:text-gray-600 dark:hover:text-[#e9edef] text-xl leading-none transition-colors">&times;</button>
            </div>
            <form onSubmit={handleAddStudent} className="p-6 space-y-4">
              {[
                { label: 'Full Name', key: 'name', type: 'text', placeholder: 'Ahmed Ali' },
                { label: 'WhatsApp Phone', key: 'phone', type: 'tel', placeholder: '+201234567890' },
                { label: 'Grade', key: 'grade', type: 'text', placeholder: 'Grade 10' },
                { label: 'Enrolled Course', key: 'enrolledCourse', type: 'text', placeholder: 'Mathematics' },
              ].map(field => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#8696a0] mb-1">{field.label}</label>
                  <input
                    type={field.type}
                    value={(form as Record<string, string>)[field.key]}
                    onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    required={field.key === 'name' || field.key === 'phone'}
                    className={modalInputCls}
                  />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-[#8696a0] mb-1">Payment Status</label>
                <select
                  value={form.paymentStatus}
                  onChange={e => setForm(f => ({ ...f, paymentStatus: e.target.value }))}
                  className={modalInputCls}
                >
                  <option value="Pending">Pending</option>
                  <option value="Paid">Paid</option>
                  <option value="Unpaid">Unpaid</option>
                </select>
              </div>
              {formError && <p className="text-red-500 text-sm">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2 border border-gray-300 dark:border-[#374151] rounded-lg text-sm font-medium text-gray-700 dark:text-[#8696a0] hover:bg-gray-50 dark:hover:bg-[#202c33] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-[#00a884] hover:bg-[#00967a] disabled:opacity-60 transition-colors"
                >
                  {saving ? 'Saving…' : 'Add Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
