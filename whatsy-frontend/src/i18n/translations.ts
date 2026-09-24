import { useLanguageStore } from '../store/useLanguageStore'

type Translations = {
  // NavBar
  nav_inbox: string
  nav_students: string
  nav_broadcasts: string
  nav_team: string
  nav_analysis: string
  nav_connection: string
  nav_settings: string
  nav_theme: string
  nav_language: string
  nav_light_mode: string
  nav_dark_mode: string
  nav_change_password: string
  nav_sign_out: string
  // Sidebar
  sidebar_chats: string
  sidebar_mark_all_read_title: string
  sidebar_new_chat_title: string
  sidebar_menu_title: string
  sidebar_refresh: string
  sidebar_mark_all_read: string
  sidebar_open_settings: string
  sidebar_export_unavailable: string
  sidebar_new_chat_heading: string
  sidebar_search_student_placeholder: string
  sidebar_no_contacts: string
  sidebar_wa_contact: string
  sidebar_search_placeholder: string
  filter_all: string
  filter_unread: string
  filter_unanswered: string
  filter_mine: string
  sidebar_no_conversations: string
  // ChatWindow
  chatwindow_empty_heading: string
  chatwindow_empty_body: string
  chatwindow_encrypted: string
  online: string
  offline: string
  last_seen: string
  is_typing: string
  assign: string
  unassigned: string
  unassign: string
  search_in_chat: string
  more_options: string
  mark_as_read: string
  mark_as_unread: string
  viewing: string
  date_today: string
  date_yesterday: string
  reply_you: string
  // ChatInput
  type_a_message: string
  photos_and_videos: string
  document: string
  interactive_template: string
  emoji: string
  attach_file: string
  send_message: string
  record_voice_note: string
  cancel: string
  view_only_mode: string
  view_only_placeholder: string
  // MessageBubble
  read_more: string
  voice_message: string
  photo: string
  video: string
  audio: string
  location: string
  contact: string
  sticker: string
  unsupported_message: string
  unable_to_load_image: string
  open_download_image: string
  download_image: string
  download: string
  tap_to_retry: string
  reply: string
  // ConversationRow
  unknown_contact: string
  no_messages_yet: string
  chat_options: string
  unsupported_message_preview: string
  // App
  reconnecting: string
  connected: string
  mark_all_read_confirm: (count: number) => string
  signed_in_elsewhere: string
  signed_in_elsewhere_body: string
  access_denied: string
  access_denied_body: string
  return_to_inbox: string
  // ChangePasswordModal
  change_password: string
  set_password_for: (name: string) => string
  current_password: string
  new_password: string
  confirm_new_password: string
  enter_current_password: string
  min_8_characters: string
  re_enter_password: string
  update_password: string
  updating: string
  password_updated: string
  error_min_8: string
  error_passwords_no_match: string
  error_current_required: string
  // Login
  wa_shared_inbox: string
  email: string
  password: string
  show: string
  hide: string
  sign_in: string
  signing_in: string
  error_invalid_credentials: string
  error_server: string
  error_connection: string
  // Roles
  role_admin: string
  role_agent: string
  role_viewer: string
}

export const en: Translations = {
  nav_inbox: 'Inbox',
  nav_students: 'Students',
  nav_broadcasts: 'Broadcasts',
  nav_team: 'Team',
  nav_analysis: 'Analysis',
  nav_connection: 'Connection',
  nav_settings: 'Settings',
  nav_theme: 'Theme',
  nav_language: 'Language',
  nav_light_mode: 'Light mode',
  nav_dark_mode: 'Dark mode',
  nav_change_password: 'Change password',
  nav_sign_out: 'Sign out',
  sidebar_chats: 'Chats',
  sidebar_mark_all_read_title: 'Mark all as read',
  sidebar_new_chat_title: 'New Chat',
  sidebar_menu_title: 'Menu',
  sidebar_refresh: 'Refresh conversations',
  sidebar_mark_all_read: 'Mark all as read',
  sidebar_open_settings: 'Open inbox settings',
  sidebar_export_unavailable: 'Export and archived chats are not available yet.',
  sidebar_new_chat_heading: 'New chat',
  sidebar_search_student_placeholder: 'Search a student or phone',
  sidebar_no_contacts: 'No contacts found in your conversations.',
  sidebar_wa_contact: 'WhatsApp contact',
  sidebar_search_placeholder: 'Search or start a new chat',
  filter_all: 'All',
  filter_unread: 'Unread',
  filter_unanswered: 'Unanswered',
  filter_mine: 'Mine',
  sidebar_no_conversations: 'No conversations found',
  chatwindow_empty_heading: 'WhatsApp for Web & Zernio Inbox',
  chatwindow_empty_body: 'Send and receive real-time messages across WhatsApp, multi-agent teams, and cloud channels without keeping your phone connected.',
  chatwindow_encrypted: 'End-to-end encrypted via Zernio Gateway',
  online: 'online',
  offline: 'offline',
  last_seen: 'last seen',
  is_typing: 'is typing',
  assign: 'Assign',
  unassigned: 'Unassigned',
  unassign: 'Unassign',
  search_in_chat: 'Search in chat',
  more_options: 'More Options',
  mark_as_read: 'Mark as read',
  mark_as_unread: 'Mark as unread',
  viewing: 'Viewing:',
  date_today: 'TODAY',
  date_yesterday: 'YESTERDAY',
  reply_you: 'You',
  type_a_message: 'Type a message',
  photos_and_videos: 'Photos & Videos',
  document: 'Document',
  interactive_template: 'Interactive Template',
  emoji: 'Emoji',
  attach_file: 'Attach Document',
  send_message: 'Send Message',
  record_voice_note: 'Record Voice Note',
  cancel: 'Cancel',
  view_only_mode: 'View-only mode',
  view_only_placeholder: 'View-only mode: only agents and admins can send messages.',
  read_more: '... Read more',
  voice_message: '🎤 Voice message',
  photo: '📷 Photo',
  video: '🎥 Video',
  audio: '🎵 Audio',
  location: '📍 Location',
  contact: '👤 Contact',
  sticker: '🎨 Sticker',
  unsupported_message: 'Unsupported message',
  unable_to_load_image: 'Unable to load image',
  open_download_image: 'Open or download image',
  download_image: 'Download image',
  download: 'Download',
  tap_to_retry: 'Tap to retry',
  reply: 'Reply',
  unknown_contact: 'Unknown Contact',
  no_messages_yet: 'No messages yet',
  chat_options: 'Chat options',
  unsupported_message_preview: '⚠️ Unsupported message',
  reconnecting: 'Reconnecting…',
  connected: 'Connected',
  mark_all_read_confirm: (count) => `Mark all ${count} conversation${count === 1 ? '' : 's'} as read?`,
  signed_in_elsewhere: 'Signed in elsewhere',
  signed_in_elsewhere_body: 'Your account was signed in from another device. Redirecting to login…',
  access_denied: 'Access Denied',
  access_denied_body: "You don't have administrator permissions to access this page. Please contact your administrator.",
  return_to_inbox: 'Return to Inbox',
  change_password: 'Change Password',
  set_password_for: (name) => `Set Password for ${name}`,
  current_password: 'Current Password',
  new_password: 'New Password',
  confirm_new_password: 'Confirm New Password',
  enter_current_password: 'Enter current password',
  min_8_characters: 'Min. 8 characters',
  re_enter_password: 'Re-enter new password',
  update_password: 'Update Password',
  updating: 'Updating…',
  password_updated: 'Password updated successfully!',
  error_min_8: 'New password must be at least 8 characters',
  error_passwords_no_match: 'Passwords do not match',
  error_current_required: 'Current password is required',
  wa_shared_inbox: 'WhatsApp Shared Inbox',
  email: 'Email',
  password: 'Password',
  show: 'Show',
  hide: 'Hide',
  sign_in: 'Sign In',
  signing_in: 'Signing in…',
  error_invalid_credentials: 'Invalid email or password',
  error_server: 'Server error, please try again',
  error_connection: 'Connection error',
  role_admin: 'Admin',
  role_agent: 'Agent',
  role_viewer: 'Viewer',
}

export const ar: Translations = {
  nav_inbox: 'الرسائل',
  nav_students: 'الطلاب',
  nav_broadcasts: 'الإذاعة',
  nav_team: 'الفريق',
  nav_analysis: 'التحليلات',
  nav_connection: 'الاتصال',
  nav_settings: 'الإعدادات',
  nav_theme: 'المظهر',
  nav_language: 'اللغة',
  nav_light_mode: 'الوضع الفاتح',
  nav_dark_mode: 'الوضع الداكن',
  nav_change_password: 'تغيير كلمة المرور',
  nav_sign_out: 'تسجيل الخروج',
  sidebar_chats: 'المحادثات',
  sidebar_mark_all_read_title: 'تحديد الكل كمقروء',
  sidebar_new_chat_title: 'محادثة جديدة',
  sidebar_menu_title: 'القائمة',
  sidebar_refresh: 'تحديث المحادثات',
  sidebar_mark_all_read: 'تحديد الكل كمقروء',
  sidebar_open_settings: 'فتح إعدادات البريد الوارد',
  sidebar_export_unavailable: 'تصدير المحادثات وأرشفتها غير متاح بعد.',
  sidebar_new_chat_heading: 'محادثة جديدة',
  sidebar_search_student_placeholder: 'ابحث عن طالب أو رقم هاتف',
  sidebar_no_contacts: 'لم يتم العثور على جهات اتصال.',
  sidebar_wa_contact: 'جهة اتصال واتساب',
  sidebar_search_placeholder: 'ابحث أو ابدأ محادثة جديدة',
  filter_all: 'الكل',
  filter_unread: 'غير مقروء',
  filter_unanswered: 'بلا رد',
  filter_mine: 'لي',
  sidebar_no_conversations: 'لا توجد محادثات',
  chatwindow_empty_heading: 'واتساب للويب وZernio Inbox',
  chatwindow_empty_body: 'أرسل واستقبل الرسائل في الوقت الفعلي عبر واتساب وفرق متعددة وقنوات سحابية دون الحاجة إلى توصيل هاتفك.',
  chatwindow_encrypted: 'مشفّر من طرف إلى طرف عبر Zernio Gateway',
  online: 'متصل',
  offline: 'غير متصل',
  last_seen: 'آخر ظهور',
  is_typing: 'يكتب',
  assign: 'تعيين',
  unassigned: 'غير معيّن',
  unassign: 'إلغاء التعيين',
  search_in_chat: 'بحث في المحادثة',
  more_options: 'المزيد',
  mark_as_read: 'تحديد كمقروء',
  mark_as_unread: 'تحديد كغير مقروء',
  viewing: 'يشاهد:',
  date_today: 'اليوم',
  date_yesterday: 'أمس',
  reply_you: 'أنت',
  type_a_message: 'اكتب رسالة',
  photos_and_videos: 'الصور والفيديوهات',
  document: 'مستند',
  interactive_template: 'قالب تفاعلي',
  emoji: 'إيموجي',
  attach_file: 'إرفاق ملف',
  send_message: 'إرسال الرسالة',
  record_voice_note: 'تسجيل رسالة صوتية',
  cancel: 'إلغاء',
  view_only_mode: 'وضع المشاهدة فقط',
  view_only_placeholder: 'وضع المشاهدة فقط: يمكن للوكلاء والمديرين فقط إرسال الرسائل.',
  read_more: '... اقرأ المزيد',
  voice_message: '🎤 رسالة صوتية',
  photo: '📷 صورة',
  video: '🎥 فيديو',
  audio: '🎵 مقطع صوتي',
  location: '📍 موقع',
  contact: '👤 جهة اتصال',
  sticker: '🎨 ملصق',
  unsupported_message: 'رسالة غير مدعومة',
  unable_to_load_image: 'تعذّر تحميل الصورة',
  open_download_image: 'فتح الصورة أو تنزيلها',
  download_image: 'تنزيل الصورة',
  download: 'تنزيل',
  tap_to_retry: 'انقر للإعادة',
  reply: 'رد',
  unknown_contact: 'جهة اتصال غير معروفة',
  no_messages_yet: 'لا توجد رسائل بعد',
  chat_options: 'خيارات المحادثة',
  unsupported_message_preview: '⚠️ رسالة غير مدعومة',
  reconnecting: 'جارٍ إعادة الاتصال…',
  connected: 'متصل',
  mark_all_read_confirm: (count) => `تحديد ${count} محادثة كمقروءة؟`,
  signed_in_elsewhere: 'تم تسجيل الدخول في مكان آخر',
  signed_in_elsewhere_body: 'تم تسجيل الدخول إلى حسابك من جهاز آخر. جارٍ التوجيه إلى صفحة تسجيل الدخول…',
  access_denied: 'تم رفض الوصول',
  access_denied_body: 'ليس لديك صلاحيات المسؤول للوصول إلى هذه الصفحة. يرجى التواصل مع المسؤول.',
  return_to_inbox: 'العودة إلى الرسائل',
  change_password: 'تغيير كلمة المرور',
  set_password_for: (name) => `تعيين كلمة مرور لـ ${name}`,
  current_password: 'كلمة المرور الحالية',
  new_password: 'كلمة المرور الجديدة',
  confirm_new_password: 'تأكيد كلمة المرور الجديدة',
  enter_current_password: 'أدخل كلمة المرور الحالية',
  min_8_characters: '٨ أحرف على الأقل',
  re_enter_password: 'أعد إدخال كلمة المرور الجديدة',
  update_password: 'تحديث كلمة المرور',
  updating: 'جارٍ التحديث…',
  password_updated: 'تم تحديث كلمة المرور بنجاح!',
  error_min_8: 'يجب أن تتكون كلمة المرور الجديدة من ٨ أحرف على الأقل',
  error_passwords_no_match: 'كلمتا المرور غير متطابقتين',
  error_current_required: 'كلمة المرور الحالية مطلوبة',
  wa_shared_inbox: 'صندوق واتساب المشترك',
  email: 'البريد الإلكتروني',
  password: 'كلمة المرور',
  show: 'إظهار',
  hide: 'إخفاء',
  sign_in: 'تسجيل الدخول',
  signing_in: 'جارٍ تسجيل الدخول…',
  error_invalid_credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  error_server: 'خطأ في الخادم، يرجى المحاولة مرة أخرى',
  error_connection: 'خطأ في الاتصال',
  role_admin: 'مسؤول',
  role_agent: 'وكيل',
  role_viewer: 'مشاهد',
}

export function useT(): Translations {
  const lang = useLanguageStore((s) => s.lang)
  return lang === 'ar' ? ar : en
}
