# Back-Office Operations Dashboard - Complete Requirements Document

**Project Name:** Back-Office Operations Management System  
**Version:** 1.0  
**Date:** March 10, 2026  
**Prepared For:** Google Gemini 2.0 (Antigravity) Development  
**Team:** 3 users (2 in Coimbatore office, 1 in Australia)

---

## 📋 Executive Summary

A modern, intuitive web application for managing back-office operations, tasks, and project workflows. The system replaces the existing Excel-based workflow with a real-time, collaborative, visually stunning interface accessible globally.

---

## 🎯 Project Goals

1. **Replace Excel Workflow** - Transform static spreadsheet into dynamic web app
2. **Real-Time Collaboration** - 3 users working simultaneously across locations
3. **Zero Hosting Cost** - Deploy on GitHub Pages or similar free platform
4. **Mobile-First Design** - Responsive across all devices
5. **Intuitive UX** - Minimal learning curve, maximum productivity

---

## 👥 User Roles & Access

### Users
- **Pritheeswarar** - Admin & User (Coimbatore)
- **Mubarak** - User (Coimbatore)
- **Sudharshan** - User (Australia)

### Access Level
- All users have equal permissions (no role hierarchy needed)
- All users can create, edit, view, and update tasks
- Simple password protection or optional GitHub authentication

---

## 🏗️ System Architecture

### Technology Stack (Recommended)
```
Frontend: React.js or Vanilla JavaScript (single-page application)
Styling: Tailwind CSS + Custom CSS
Data Storage: JSON files in GitHub repository (Git as database)
Hosting: GitHub Pages (FREE)
Authentication: Simple password or GitHub OAuth
Charts: Chart.js or Recharts
Drag-Drop: React DnD or SortableJS
```

### Data Structure
```json
{
  "tasks": [
    {
      "id": 1,
      "client": "JS Roofing",
      "project": "House 12",
      "task": "Create PO fascia",
      "staff": "Mubarak",
      "status": "In Progress",
      "priority": "High",
      "startDate": "2026-03-09",
      "dueDate": "2026-03-10",
      "waitingFor": "Supplier",
      "notes": "Waiting for supplier pricing",
      "createdAt": "2026-03-09T10:30:00Z",
      "updatedAt": "2026-03-10T14:20:00Z"
    }
  ],
  "config": {
    "clients": ["JS Roofing", "A to Z Roofing", "Allvent", "Malligai Sweets"],
    "staff": ["Mubarak", "Eswar"],
    "statuses": ["New", "In Progress", "Waiting Client", "Waiting Supplier", "Follow Up", "Completed"],
    "priorities": ["High", "Medium", "Low"]
  }
}
```

---

## 🎨 UI/UX Design System

### Color Palette

#### Primary Colors
```css
--primary-blue: #2563eb;        /* Primary actions, links */
--primary-blue-hover: #1d4ed8;  /* Hover states */
--primary-blue-light: #dbeafe;  /* Backgrounds, badges */

--secondary-purple: #7c3aed;    /* Secondary actions */
--secondary-purple-hover: #6d28d9;
--secondary-purple-light: #ede9fe;
```

#### Status Colors
```css
--status-new: #3b82f6;          /* New - Blue */
--status-progress: #f59e0b;     /* In Progress - Amber */
--status-waiting-client: #ec4899; /* Waiting Client - Pink */
--status-waiting-supplier: #8b5cf6; /* Waiting Supplier - Purple */
--status-followup: #10b981;     /* Follow Up - Green */
--status-completed: #6b7280;    /* Completed - Gray */
```

#### Priority Colors
```css
--priority-high: #ef4444;       /* High - Red */
--priority-medium: #f59e0b;     /* Medium - Amber */
--priority-low: #3b82f6;        /* Low - Blue */
```

#### Neutral Colors
```css
--gray-50: #f9fafb;
--gray-100: #f3f4f6;
--gray-200: #e5e7eb;
--gray-300: #d1d5db;
--gray-400: #9ca3af;
--gray-500: #6b7280;
--gray-600: #4b5563;
--gray-700: #374151;
--gray-800: #1f2937;
--gray-900: #111827;

--white: #ffffff;
--black: #000000;
```

#### Background & Surface
```css
--bg-page: #f9fafb;             /* Page background */
--bg-card: #ffffff;             /* Card backgrounds */
--bg-hover: #f3f4f6;            /* Hover backgrounds */
--border-color: #e5e7eb;        /* Borders */
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
```

### Typography
```css
--font-family: 'Inter', 'Segoe UI', 'Roboto', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;

/* Font Sizes */
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
--text-3xl: 1.875rem;  /* 30px */
--text-4xl: 2.25rem;   /* 36px */

/* Font Weights */
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

### Spacing System
```css
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-5: 1.25rem;   /* 20px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
--space-10: 2.5rem;   /* 40px */
--space-12: 3rem;     /* 48px */
--space-16: 4rem;     /* 64px */
```

### Border Radius
```css
--radius-sm: 0.375rem;   /* 6px */
--radius-md: 0.5rem;     /* 8px */
--radius-lg: 0.75rem;    /* 12px */
--radius-xl: 1rem;       /* 16px */
--radius-full: 9999px;   /* Fully rounded */
```

---

## 📱 Application Layout

### Main Layout Structure

```
┌──────────────────────────────────────────────────────────┐
│  HEADER (Fixed Top)                                      │
│  ┌────────────┬──────────────────────┬────────────────┐ │
│  │ Logo       │ Navigation Tabs      │ User Menu      │ │
│  └────────────┴──────────────────────┴────────────────┘ │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  MAIN CONTENT AREA                                       │
│  (Dashboard / Kanban / Tasks / Today's Tasks)            │
│                                                          │
│                                                          │
│                                                          │
│                                                          │
│                                                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Header Design Specifications

**Height:** 64px  
**Background:** White with bottom border (--gray-200)  
**Shadow:** 0 1px 3px rgba(0,0,0,0.1)

#### Components:
1. **Logo Area (Left)**
   - Icon + "BackOffice Pro" text
   - Width: 240px
   - Font: 600 weight, 20px

2. **Navigation Tabs (Center)**
   - Tabs: Dashboard | Kanban Board | All Tasks | Today's Tasks
   - Active tab: Blue underline (3px), blue text
   - Inactive: Gray text, hover effect
   - Font: 500 weight, 16px

3. **User Menu (Right)**
   - Search bar (expandable)
   - Notification bell icon (with badge)
   - User avatar + name dropdown
   - Quick actions menu

---

## 🎯 Feature Modules

---

## MODULE 1: Dashboard View 📊

### Layout
```
┌────────────────────────────────────────────────────────────┐
│  DASHBOARD                                       [Refresh] │
├────────────────────────────────────────────────────────────┤
│  ┌─────────────┬─────────────┬─────────────┬───────────┐ │
│  │ Open Tasks  │ In Progress │ Completed   │ Overdue   │ │
│  │    11       │      3      │      1      │     0     │ │
│  └─────────────┴─────────────┴─────────────┴───────────┘ │
│                                                            │
│  ┌──────────────────────────┬────────────────────────────┐│
│  │ Tasks by Status (Chart)  │ Tasks by Priority (Chart) ││
│  │                          │                            ││
│  │  [Donut Chart]           │  [Bar Chart]               ││
│  │                          │                            ││
│  └──────────────────────────┴────────────────────────────┘│
│                                                            │
│  ┌──────────────────────────┬────────────────────────────┐│
│  │ Workload by Staff        │ Client Activity           ││
│  │                          │                            ││
│  │  [Horizontal Bar]        │  [Pie Chart]               ││
│  │                          │                            ││
│  └──────────────────────────┴────────────────────────────┘│
│                                                            │
│  ┌────────────────────────────────────────────────────────┐│
│  │ Recent Activity Feed                                   ││
│  │ • Mubarak updated "Create PO fascia" - 2 mins ago     ││
│  │ • Eswar completed "Send revised quote" - 1 hour ago   ││
│  │ • New task created by Pritheeswarar - 3 hours ago     ││
│  └────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

### Metrics Cards Design

**Card Dimensions:** Height 120px, Responsive width  
**Border Radius:** 12px  
**Shadow:** 0 2px 8px rgba(0,0,0,0.08)  
**Hover Effect:** Lift with deeper shadow

#### Card Structure:
```
┌───────────────────────────┐
│  📊 Open Tasks            │
│                           │
│        11                 │
│                           │
│  +2 from yesterday ↑      │
└───────────────────────────┘
```

**Number Font Size:** 48px, 700 weight  
**Label Font Size:** 14px, 500 weight, gray  
**Trend Indicator:** 12px, green/red with arrow

### Charts Specifications

#### 1. Tasks by Status - Donut Chart
- **Library:** Chart.js
- **Colors:** Use status color palette
- **Center Text:** Total count
- **Legend:** Right side
- **Hover:** Highlight segment, show count + percentage
- **Animation:** Smooth rotation on load

#### 2. Tasks by Priority - Bar Chart
- **Orientation:** Vertical
- **Colors:** Priority color palette
- **X-axis:** High, Medium, Low
- **Y-axis:** Task count
- **Hover:** Show exact count
- **Grid:** Light horizontal lines only

#### 3. Workload by Staff - Horizontal Bar Chart
- **Show:** Staff name + task count
- **Colors:** Gradient blue
- **Labels:** Count at end of bar
- **Sorting:** Highest to lowest

#### 4. Client Activity - Pie Chart
- **Show:** Active tasks per client
- **Colors:** Varied palette
- **Label:** Client name + count
- **Hover:** Percentage + task breakdown

### Recent Activity Feed

**Design:**
- List format with avatar + timestamp
- Max 10 recent items
- Auto-refresh every 30 seconds
- Icons for action types (create, update, complete, delete)
- Relative timestamps ("2 mins ago")
- Click to jump to task

---

## MODULE 2: Kanban Board View 🗂️

### Layout
```
┌──────────────────────────────────────────────────────────────────┐
│  KANBAN BOARD                        [Add Task] [View: All ▾]   │
├──────────────────────────────────────────────────────────────────┤
│ ┌───────────┬───────────┬───────────┬───────────┬───────────┐   │
│ │    NEW    │IN PROGRESS│  WAITING  │ FOLLOW UP │ COMPLETED │   │
│ │    (3)    │    (3)    │  CLIENT   │    (2)    │    (1)    │   │
│ │           │           │    (2)    │           │           │   │
│ ├───────────┼───────────┼───────────┼───────────┼───────────┤   │
│ │[Card 1]   │[Card 1]   │[Card 1]   │[Card 1]   │[Card 1]   │   │
│ │           │           │           │           │           │   │
│ │[Card 2]   │[Card 2]   │[Card 2]   │[Card 2]   │           │   │
│ │           │           │           │           │           │   │
│ │[Card 3]   │[Card 3]   │           │           │           │   │
│ │           │           │           │           │           │   │
│ │           │           │           │           │           │   │
│ │           │           │           │           │           │   │
│ │[+ Add]    │[+ Add]    │[+ Add]    │[+ Add]    │           │   │
│ └───────────┴───────────┴───────────┴───────────┴───────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Column Design

**Width:** Equal flex distribution (min 280px each)  
**Background:** Light gray (--gray-50)  
**Border Radius:** 12px  
**Padding:** 16px  
**Gap:** 16px between columns

#### Column Header
```
┌─────────────────────────┐
│ 🔵 NEW            (3)   │
└─────────────────────────┘
```
- Status icon + name (left)
- Count badge (right)
- Bold text (16px, 600 weight)
- Status-specific color accent

#### Add Card Button
```
┌─────────────────────────┐
│    + Add New Task       │
└─────────────────────────┘
```
- Dashed border
- Center aligned
- Hover: Solid border, blue accent

### Task Card Design

```
┌───────────────────────────────────┐
│ [#1] 🏠 JS Roofing                │ ← Task ID + Client
│ House 12                           │ ← Project
│                                    │
│ Create PO fascia                   │ ← Task Name
│                                    │
│ 👤 Mubarak    🔴 HIGH              │ ← Assignee + Priority
│ 📅 Due: Mar 10  ⏰ Supplier        │ ← Due Date + Waiting For
│                                    │
│ 📝 Waiting for supplier pricing    │ ← Notes (truncated)
└───────────────────────────────────┘
```

**Card Specifications:**
- **Width:** 100% of column (min 260px)
- **Padding:** 16px
- **Border Radius:** 10px
- **Background:** White
- **Shadow:** 0 2px 4px rgba(0,0,0,0.08)
- **Hover:** Lift effect + deeper shadow
- **Border:** Left 4px border in priority color

**Drag & Drop Behavior:**
- Smooth animation
- Placeholder card shows in target column
- Snap to position
- Auto-save on drop
- Visual feedback (opacity 0.7 while dragging)

**Card Interactions:**
- Click: Open task details modal
- Drag: Move to different status
- Right-click: Context menu (Edit, Delete, Duplicate)

### Status Columns

| Status | Icon | Color | Count Display |
|--------|------|-------|---------------|
| New | 🆕 | Blue | Badge top-right |
| In Progress | ⚙️ | Amber | Badge top-right |
| Waiting Client | 👥 | Pink | Badge top-right |
| Waiting Supplier | 📦 | Purple | Badge top-right |
| Follow Up | 📞 | Green | Badge top-right |
| Completed | ✅ | Gray | Badge top-right |

### Filters & Views

**Filter Bar:**
```
┌────────────────────────────────────────────────────┐
│ Staff: [All ▾]  Priority: [All ▾]  Client: [All ▾] │
└────────────────────────────────────────────────────┘
```
- Dropdowns with multi-select
- Active filters shown as badges
- Clear all button
- Persist filter state

---

## MODULE 3: All Tasks View 📋

### Layout
```
┌──────────────────────────────────────────────────────────────┐
│  ALL TASKS                    [Add Task] [Export] [Filter]  │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 🔍 Search tasks...                    [Bulk Actions]  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ☐ ID  Client      Project    Task         Staff  ...│   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ ☐ 1   JS Roofing  House 12   Create PO   Mubarak  ⚙️│   │
│  │ ☐ 2   JS Roofing  House 13   Xero rec... Eswar    🆕│   │
│  │ ☐ 3   JS Roofing  House 14   Follow up   Mubarak  📞│   │
│  │ ☐ 4   A to Z...   House 5    Prepare...  Eswar    ⚙️│   │
│  │ ☐ 5   A to Z...   House 5    Waiting...  Mubarak  👥│   │
│  │ ... (more rows)                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Showing 1-10 of 12 tasks    [< Prev]  [1] 2  [Next >]     │
└──────────────────────────────────────────────────────────────┘
```

### Table Design

**Table Style:** Modern, clean, striped rows  
**Row Height:** 56px  
**Header:** Sticky on scroll, gray background  
**Borders:** Light gray horizontal lines only

#### Columns

| Column | Width | Sortable | Filterable |
|--------|-------|----------|------------|
| Checkbox | 40px | No | No |
| Task ID | 60px | Yes | No |
| Client | 140px | Yes | Yes |
| Project | 120px | Yes | Yes |
| Task | 200px | Yes | No |
| Staff | 100px | Yes | Yes |
| Status | 120px | Yes | Yes |
| Priority | 80px | Yes | Yes |
| Due Date | 100px | Yes | Yes |
| Actions | 100px | No | No |

**Column Headers:**
- Bold text (14px, 600 weight)
- Sort icons (up/down arrows)
- Click to sort
- Filter icon on filterable columns

### Row Design

**Normal State:**
- White background
- Gray text (--gray-700)
- 14px font size

**Hover State:**
- Light blue background (--primary-blue-light)
- Pointer cursor

**Selected State:**
- Checkbox checked
- Slightly darker blue background
- Row highlight

### Status Badge
```
┌─────────────┐
│ 🆕 New      │
└─────────────┘
```
- Rounded pill shape
- Status color background (light)
- Status color text (dark)
- Icon + text

### Priority Badge
```
┌─────────┐
│ 🔴 HIGH │
└─────────┘
```
- Small badge
- Priority color
- Bold text

### Actions Column

**Icons:**
- 👁️ View details
- ✏️ Edit
- 🗑️ Delete

**Behavior:**
- Show on row hover
- Icon buttons
- Tooltip on hover

### Search & Filters

**Search Bar:**
- Width: 400px (expandable)
- Placeholder: "Search tasks, clients, projects..."
- Real-time search (debounced 300ms)
- Search icon left, clear icon right

**Filter Panel (Slide-in from right):**
```
┌─────────────────────────┐
│  FILTERS            [X] │
├─────────────────────────┤
│  Staff                  │
│  ☐ Mubarak              │
│  ☐ Eswar                │
│                         │
│  Status                 │
│  ☐ New                  │
│  ☐ In Progress          │
│  ☐ Waiting Client       │
│  ☐ Waiting Supplier     │
│  ☐ Follow Up            │
│  ☐ Completed            │
│                         │
│  Priority               │
│  ☐ High                 │
│  ☐ Medium               │
│  ☐ Low                  │
│                         │
│  Date Range             │
│  From: [Date Picker]    │
│  To: [Date Picker]      │
│                         │
│  [Clear] [Apply Filters]│
└─────────────────────────┘
```

### Bulk Actions

**Dropdown Menu:**
- Update Status
- Assign to Staff
- Change Priority
- Delete Selected
- Export Selected

---

## MODULE 4: Today's Tasks View ⏰

### Layout
```
┌──────────────────────────────────────────────────────────┐
│  TODAY'S TASKS                              March 10, 2026│
├──────────────────────────────────────────────────────────┤
│  ┌──────────────┬──────────────┬──────────────┐         │
│  │  DUE TODAY   │   OVERDUE    │  FOLLOW UP   │         │
│  │      4       │      0       │      0       │         │
│  └──────────────┴──────────────┴──────────────┘         │
│                                                          │
│  DUE TODAY (4 tasks)                                     │
│  ┌────────────────────────────────────────────────────┐ │
│  │ [#1] 🔴 HIGH | Create PO fascia                    │ │
│  │ 🏠 JS Roofing - House 12                           │ │
│  │ 👤 Mubarak  |  ⚙️ In Progress  |  ⏰ 6:00 PM       │ │
│  │ [Mark Complete]  [View Details]                    │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │ [#4] 🔴 HIGH | Prepare quote                       │ │
│  │ 🏠 A to Z Roofing - House 5                        │ │
│  │ 👤 Eswar  |  ⚙️ In Progress  |  ⏰ 8:00 PM         │ │
│  │ [Mark Complete]  [View Details]                    │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  (More cards...)                                         │
│                                                          │
│  OVERDUE (0 tasks)                                       │
│  ✅ All caught up! No overdue tasks.                     │
│                                                          │
│  FOLLOW UP TODAY OR EARLIER (0 tasks)                   │
│  ✅ No follow-ups needed today.                          │
└──────────────────────────────────────────────────────────┘
```

### Summary Cards

**Design:** Same as Dashboard metrics cards  
**Colors:**
- Due Today: Blue
- Overdue: Red (with pulse animation if >0)
- Follow Up: Green

### Task Cards

**Full Width Cards:**
- Height: Auto (min 100px)
- Padding: 20px
- Border Radius: 12px
- Shadow: 0 2px 8px rgba(0,0,0,0.08)
- Left border: 4px in priority color
- Hover: Slight lift

**Card Layout:**
```
┌──────────────────────────────────────────────────┐
│ [#1] 🔴 HIGH                        [⋯ Menu]    │
│                                                  │
│ Create PO fascia                                 │
│                                                  │
│ 🏠 JS Roofing › House 12                        │
│                                                  │
│ ┌────────────┬──────────────┬─────────────┐    │
│ │👤 Mubarak  │⚙️ In Progress│⏰ 6:00 PM   │    │
│ └────────────┴──────────────┴─────────────┘    │
│                                                  │
│ 📝 Waiting for supplier pricing                 │
│                                                  │
│ [✓ Mark Complete]      [👁️ View Details]       │
└──────────────────────────────────────────────────┘
```

### Grouping & Sorting

**Default Grouping:**
1. Due Today (sorted by priority: High → Low)
2. Overdue (sorted by due date: oldest first)
3. Follow Up Today (sorted by priority)

**Time Display:**
- Show time if available
- Relative time ("in 3 hours", "2 hours ago")
- Red text for overdue

### Quick Actions

**Buttons:**
- Mark Complete (primary)
- View Details (secondary)
- Snooze (reschedule)
- Quick Edit (inline)

---

## MODULE 5: Task Details Modal 📝

### Modal Design

**Size:** 700px wide, auto height (max 90vh)  
**Position:** Center screen  
**Backdrop:** Dark overlay (rgba(0,0,0,0.5))  
**Animation:** Fade in + scale up

### Layout
```
┌────────────────────────────────────────────────────┐
│  Task Details                           [✕ Close] │
├────────────────────────────────────────────────────┤
│                                                    │
│  Task ID: #1                    🔴 HIGH Priority  │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │ Client                                       │ │
│  │ JS Roofing                                   │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │ Project                                      │ │
│  │ House 12                                     │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │ Task Name                                    │ │
│  │ Create PO fascia                             │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ┌─────────────────┬────────────────────────────┐ │
│  │ Assigned To     │ Status                     │ │
│  │ Mubarak    ▾    │ In Progress           ▾    │ │
│  └─────────────────┴────────────────────────────┘ │
│                                                    │
│  ┌─────────────────┬────────────────────────────┐ │
│  │ Start Date      │ Due Date                   │ │
│  │ Mar 9, 2026     │ Mar 10, 2026               │ │
│  └─────────────────┴────────────────────────────┘ │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │ Waiting For (Optional)                       │ │
│  │ Supplier                                ▾    │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │ Notes                                        │ │
│  │ Waiting for supplier pricing...              │ │
│  │                                              │ │
│  │                                              │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │ Activity Log                                 │ │
│  │ • Status changed to "In Progress" - 2h ago  │ │
│  │ • Task created by Pritheeswarar - 1d ago    │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  [Cancel]                         [Save Changes] │
└────────────────────────────────────────────────────┘
```

### Form Fields

#### Input Fields
- **Style:** Clean, minimal
- **Height:** 44px
- **Border:** 1px solid gray-300
- **Focus:** Blue border, subtle shadow
- **Padding:** 12px
- **Border Radius:** 8px

#### Dropdowns
- **Custom styled** (not native)
- **Search enabled** for long lists
- **Icons** for visual context
- **Hover states**

#### Date Pickers
- **Calendar widget**
- **Quick select** (Today, Tomorrow, Next Week)
- **Keyboard navigation**
- **Clear button**

#### Text Area (Notes)
- **Min height:** 100px
- **Auto-resize**
- **Character counter** (optional)
- **Markdown support** (optional)

### Activity Log

**Design:**
- Timeline style
- Avatar + action + timestamp
- Expandable for full history
- Auto-scroll to latest

### Buttons

**Primary (Save):**
- Blue background
- White text
- Full width on mobile
- Loading state with spinner

**Secondary (Cancel):**
- Gray border
- Gray text
- Hover: Light gray background

---

## MODULE 6: Add/Edit Task Form ➕

### Quick Add Button (Floating)

**Position:** Bottom-right corner  
**Size:** 64px × 64px  
**Color:** Primary blue  
**Icon:** + symbol  
**Shadow:** Large shadow  
**Hover:** Slight scale up  
**Fixed:** Stays visible on scroll

### Form Modal (Same as Task Details)

**Two Modes:**
1. **Add New Task** - Empty form
2. **Edit Task** - Pre-filled form

**Validation:**
- Required fields: Task Name, Client, Assigned To, Due Date
- Real-time validation
- Error messages below fields
- Disable save until valid

### Auto-Save

**Draft Feature:**
- Save form state in localStorage
- Restore on accidental close
- "Restore draft" prompt

---

## MODULE 7: Configuration/Settings ⚙️

### Settings Panel

**Access:** Gear icon in header  
**Layout:** Side drawer (right)

```
┌──────────────────────────┐
│  SETTINGS          [✕]  │
├──────────────────────────┤
│  General                 │
│  ☐ Dark Mode             │
│  ☐ Email Notifications   │
│  ☐ Desktop Notifications │
│                          │
│  Data Management         │
│  • Manage Clients        │
│  • Manage Staff          │
│  • Import/Export         │
│  • Backup Data           │
│                          │
│  Account                 │
│  • Change Password       │
│  • Sign Out              │
│                          │
│  About                   │
│  Version: 1.0            │
│  Last Updated: Mar 2026  │
└──────────────────────────┘
```

### Manage Lists

**Modal for each list:**
```
┌──────────────────────────┐
│  MANAGE CLIENTS    [✕]  │
├──────────────────────────┤
│  Current Clients:        │
│                          │
│  • JS Roofing      [🗑️]  │
│  • A to Z Roofing  [🗑️]  │
│  • Allvent         [🗑️]  │
│  • Malligai Sweets [🗑️]  │
│                          │
│  ┌────────────────────┐ │
│  │ Add New Client    │ │
│  │ [Input]      [Add]│ │
│  └────────────────────┘ │
│                          │
│  [Close]                 │
└──────────────────────────┘
```

---

## 🔔 Notifications System

### Types

1. **Success** (Green)
   - "Task created successfully"
   - "Changes saved"
   
2. **Error** (Red)
   - "Failed to save task"
   - "Connection error"

3. **Warning** (Amber)
   - "Task due in 1 hour"
   - "Unsaved changes"

4. **Info** (Blue)
   - "3 new tasks assigned to you"
   - "Sudharshan updated a task"

### Display

**Position:** Top-right corner  
**Width:** 400px  
**Animation:** Slide in from right  
**Duration:** 5 seconds (dismissible)  
**Stack:** Max 3 visible

```
┌──────────────────────────┐
│ ✅ Success               │
│ Task created successfully│
│                     [✕] │
└──────────────────────────┘
```

---

## 📱 Responsive Design

### Breakpoints

```css
/* Mobile */
@media (max-width: 640px) { }

/* Tablet */
@media (min-width: 641px) and (max-width: 1024px) { }

/* Desktop */
@media (min-width: 1025px) { }
```

### Mobile Adaptations

**Header:**
- Hamburger menu for navigation
- Logo center aligned
- User menu in dropdown

**Dashboard:**
- Single column metrics
- Charts stack vertically
- Touch-friendly interactions

**Kanban:**
- Horizontal scroll
- Swipe to navigate columns
- Tap to expand card

**Table:**
- Card view instead of table
- Swipe to delete
- Tap to view details

**Forms:**
- Full screen modal
- Larger touch targets (min 44px)
- Native date pickers

---

## 🔐 Authentication & Security

### Login Page

```
┌──────────────────────────┐
│                          │
│    📊 BackOffice Pro     │
│                          │
│  ┌────────────────────┐ │
│  │ Username/Email    │ │
│  └────────────────────┘ │
│                          │
│  ┌────────────────────┐ │
│  │ Password     [👁️] │ │
│  └────────────────────┘ │
│                          │
│  ☐ Remember me           │
│                          │
│  [Sign In]               │
│                          │
│  Or sign in with GitHub  │
│  [🔗 GitHub OAuth]       │
└──────────────────────────┘
```

### Security Features

1. **Password Protection**
   - Minimum 8 characters
   - Stored securely (hashed)
   
2. **Session Management**
   - Auto-logout after 24 hours inactivity
   - Remember me (30 days)

3. **Data Encryption**
   - HTTPS only
   - Secure token storage

4. **Access Control**
   - All users equal permissions
   - Future: Role-based access

---

## 💾 Data Persistence & Sync

### Storage Strategy

**Primary:** GitHub Repository (as database)

```
project-repo/
├── data/
│   ├── tasks.json
│   ├── config.json
│   └── users.json
├── backups/
│   └── tasks_YYYY-MM-DD.json
└── index.html
```

### Sync Mechanism

**GitHub API Integration:**
1. Read data on load
2. Write changes via commits
3. Pull latest before write
4. Conflict resolution (last-write-wins)

**Real-Time Updates:**
- Poll for changes every 30 seconds
- WebSocket for instant sync (optional)
- Show "New updates available" banner
- Auto-merge or manual refresh

### Offline Mode

**Service Worker:**
- Cache app for offline use
- Queue changes locally
- Sync when online
- Conflict notification

---

## 📊 Performance Requirements

### Load Times

- Initial load: < 2 seconds
- Task list render: < 500ms
- Search results: < 300ms
- Kanban drag: < 16ms (60fps)

### Optimization

- Lazy load images
- Virtual scrolling for large lists
- Debounced search
- Memoized components
- Code splitting
- Minified assets

---

## 🧪 Testing Requirements

### User Testing

**Test Scenarios:**
1. Create new task
2. Update task status (drag & drop)
3. Search and filter tasks
4. View dashboard analytics
5. Mobile workflow
6. Multi-user collaboration
7. Offline mode

### Browser Support

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Mobile Safari (iOS 14+)
- Chrome Mobile (Android 10+)

---

## 🚀 Deployment Plan

### Hosting: GitHub Pages

**Steps:**
1. Create GitHub repository
2. Enable GitHub Pages
3. Deploy to `gh-pages` branch
4. Custom domain (optional)

**URL:** `https://username.github.io/backoffice-dashboard`

### Environment Variables

```
GITHUB_TOKEN=your_github_token
GITHUB_REPO=username/backoffice-dashboard
GITHUB_BRANCH=main
```

### CI/CD (Optional)

**GitHub Actions:**
- Auto-deploy on push to main
- Run tests before deploy
- Backup data daily

---

## 📚 User Documentation

### Quick Start Guide

**Include:**
1. Login instructions
2. Creating first task
3. Using Kanban board
4. Understanding dashboard
5. Keyboard shortcuts
6. Mobile tips

### Help Center

**Sections:**
- FAQs
- Video tutorials (optional)
- Keyboard shortcuts
- Troubleshooting
- Contact support

---

## 🎯 Success Metrics

### KPIs to Track

1. **Usage**
   - Daily active users
   - Tasks created per day
   - Time spent in app

2. **Performance**
   - Page load time
   - API response time
   - Error rate

3. **Productivity**
   - Task completion rate
   - Average task duration
   - Overdue tasks

---

## 🔮 Future Enhancements (Phase 2)

### Potential Features

1. **Advanced Analytics**
   - Custom reports
   - Export to PDF
   - Data visualizations

2. **Integrations**
   - Slack notifications
   - Google Calendar sync
   - Email integration

3. **Collaboration**
   - Comments on tasks
   - File attachments
   - @mentions

4. **Automation**
   - Recurring tasks
   - Auto-assign rules
   - Status workflows

5. **Mobile App**
   - Native iOS/Android
   - Push notifications
   - Offline-first

---

## 📋 Development Checklist

### Phase 1: Foundation (Week 1)
- [ ] Setup project structure
- [ ] Implement authentication
- [ ] Create layout and navigation
- [ ] Setup data storage (GitHub)

### Phase 2: Core Features (Week 2-3)
- [ ] Dashboard with charts
- [ ] All Tasks table view
- [ ] Task details modal
- [ ] Add/Edit task form

### Phase 3: Kanban (Week 4)
- [ ] Kanban board layout
- [ ] Drag & drop functionality
- [ ] Status transitions
- [ ] Card interactions

### Phase 4: Today's Tasks (Week 5)
- [ ] Today's view
- [ ] Due date calculations
- [ ] Quick actions
- [ ] Notifications

### Phase 5: Polish (Week 6)
- [ ] Mobile responsive
- [ ] Performance optimization
- [ ] Testing & bug fixes
- [ ] Documentation

---

## 🎨 Design Assets Needed

### Icons
- Use: [Heroicons](https://heroicons.com/) or [Lucide Icons](https://lucide.dev/)
- Style: Outline for inactive, filled for active
- Size: 20px standard, 24px for headers

### Images
- Logo (SVG preferred)
- Empty state illustrations
- Error state illustrations

### Fonts
- Primary: Inter (Google Fonts)
- Monospace: JetBrains Mono (optional for IDs)

---

## 💰 Cost Breakdown

### Hosting & Infrastructure
- **GitHub Pages:** ₹0 (FREE)
- **GitHub Repository:** ₹0 (FREE)
- **Domain (Optional):** ₹500-800/year
- **SSL Certificate:** ₹0 (Free with GitHub Pages)

**Total Monthly Cost:** ₹0  
**Total Annual Cost:** ₹0-800 (only if custom domain)

---

## 📞 Support & Maintenance

### Weekly Tasks
- Monitor error logs
- Backup data
- Check performance metrics
- User feedback review

### Monthly Tasks
- Security updates
- Dependency updates
- Feature requests review
- Analytics review

---

## 🎓 Training Materials

### Onboarding Checklist

**For New Users:**
1. Watch intro video (5 mins)
2. Complete tutorial tasks
3. Explore dashboard
4. Try creating a task
5. Practice Kanban drag & drop

### Quick Reference Card

**Keyboard Shortcuts:**
- `N` - New task
- `K` - Go to Kanban
- `D` - Go to Dashboard
- `T` - Go to Today's tasks
- `F` - Focus search
- `Esc` - Close modal

---

## 📧 Contact Information

**Project Owner:** Pritheeswarar Shanmugam  
**Location:** Coimbatore, Tamil Nadu, India  
**Team Size:** 3 users  
**Development Platform:** Google Gemini 2.0 (Antigravity)

---

## ✅ Final Notes for Gemini 2.0

### Key Implementation Points

1. **Use Modern JavaScript (ES6+)**
   - Arrow functions
   - Async/await
   - Destructuring
   - Spread operators

2. **Component-Based Architecture**
   - Reusable components
   - Props and state management
   - Clean separation of concerns

3. **Accessible Design**
   - ARIA labels
   - Keyboard navigation
   - Screen reader support
   - Focus management

4. **Performance First**
   - Lazy loading
   - Code splitting
   - Optimized renders
   - Minimal dependencies

5. **Mobile-First Approach**
   - Touch-friendly
   - Responsive breakpoints
   - Progressive enhancement

6. **Git-Based Database**
   - JSON data files
   - Atomic commits
   - Conflict resolution
   - Backup strategy

---

## 🎯 Final Prompt for Gemini 2.0

**Generate a complete, production-ready web application based on this requirements document. Include:**

1. Full HTML structure with semantic markup
2. Complete CSS with the design system
3. Vanilla JavaScript or React.js implementation
4. GitHub API integration for data storage
5. All features specified in modules 1-7
6. Responsive design for mobile/tablet/desktop
7. Accessibility features (ARIA, keyboard navigation)
8. Performance optimizations
9. Error handling and validation
10. Comments for maintainability

**Deliverables:**
- `index.html` - Main app file
- `styles.css` - Design system and styles
- `app.js` - Application logic
- `github-api.js` - Data persistence layer
- `README.md` - Setup and usage instructions

**Ensure the app is:**
- ✅ Production-ready
- ✅ Zero-cost hosting compatible
- ✅ Beautiful and intuitive
- ✅ Fast and performant
- ✅ Mobile-friendly
- ✅ Maintainable and documented

---

**END OF REQUIREMENTS DOCUMENT**

*This document provides complete specifications for building a modern, professional back-office operations management system. All design decisions prioritize user experience, performance, and zero-cost deployment.*
