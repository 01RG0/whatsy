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
  Paid: 'bg-green-100 text-green-800',
  Unpaid: 'bg-red-100 text-red-800',
  Pending: 'bg-yellow-100 text-yellow-800',
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

  useEffect(() => {
    fetchStudents(0, true)
  }, [])

  async function fetchStudents(newOffset = 0, reset = false) {
    reset ? setLoading(true) : setLoadingMore(true)
    try {
      const res = await fetch(`/v1/students?limit=${PAGE_SIZE}&offset=${newOffset}`, { headers: getAuthHeader() })
      if (!res.ok) throw new Error(`[${res.status}]`)
      const data = await res.json() as Student[] | { students: Student[] }
      const page = Array.isArray(data) ? data : (data.students ?? [])
      setStudents((prev) => reset ? page : [...prev, ...page])
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
      fetchStudents()
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-gray-400 hover:text-gray-600 text-sm">← Inbox</a>
          <h1 className="text-xl font-bold text-gray-800">Students</h1>
          <span className="text-sm text-gray-400">{filtered.length} total</span>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 rounded-lg text-white text-sm font-medium"
          style={{ backgroundColor: '#25D366' }}
        >
          + Add Student
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search name or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-56"
        />
        <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
          <option value="">All Grades</option>
          {grades.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={filterCourse} onChange={e => setFilterCourse(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
          <option value="">All Courses</option>
          {courses.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
          <option value="">All Payment</option>
          <option value="Paid">Paid</option>
          <option value="Unpaid">Unpaid</option>
          <option value="Pending">Pending</option>
        </select>
      </div>

      {/* Table */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">Loading students…</div>
        ) : error ? (
          <div className="flex items-center justify-center py-20 text-red-500">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-gray-400">No students found</div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Student</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Grade</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Course</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Payment</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Tags</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(student => (
                  <tr key={student.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
                          style={{ backgroundColor: '#128C7E' }}
                        >
                          {student.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">{student.name}</p>
                          <p className="text-gray-400 text-xs">{student.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{student.grade || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate">{student.enrolledCourse || '—'}</td>
                    <td className="px-4 py-3">
                      {student.paymentStatus ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_BADGE[student.paymentStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                          {student.paymentStatus}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(student.tags ?? []).slice(0, 3).map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-xs">{tag}</span>
                        ))}
                        {(student.tags ?? []).length > 3 && (
                          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">+{student.tags.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { window.location.href = `/?conv=${encodeURIComponent(student.phone)}` }}
                        className="px-3 py-1 rounded-lg text-xs font-medium text-white"
                        style={{ backgroundColor: '#25D366' }}
                      >
                        Open Chat
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 text-sm text-gray-400">
          <span>Showing {filtered.length} of {students.length} students</span>
          {hasMore && (
            <button
              onClick={() => fetchStudents(offset)}
              disabled={loadingMore}
              className="bg-[#202c33] hover:bg-[#2a3942] text-[#e9edef] px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>

      {/* Add Student Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800">Add Student</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleAddStudent} className="p-6 space-y-4">
              {[
                { label: 'Full Name', key: 'name', type: 'text', placeholder: 'Ahmed Ali' },
                { label: 'WhatsApp Phone', key: 'phone', type: 'tel', placeholder: '+201234567890' },
                { label: 'Grade', key: 'grade', type: 'text', placeholder: 'Grade 10' },
                { label: 'Enrolled Course', key: 'enrolledCourse', type: 'text', placeholder: 'Mathematics' },
              ].map(field => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                  <input
                    type={field.type}
                    value={(form as Record<string, string>)[field.key]}
                    onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    required={field.key === 'name' || field.key === 'phone'}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Status</label>
                <select
                  value={form.paymentStatus}
                  onChange={e => setForm(f => ({ ...f, paymentStatus: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="Pending">Pending</option>
                  <option value="Paid">Paid</option>
                  <option value="Unpaid">Unpaid</option>
                </select>
              </div>
              {formError && <p className="text-red-500 text-sm">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: '#25D366' }}>
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
