<!-- markdownlint-disable -->

# WeRunOps Admin Operations Portal

## Feature Enhancement Recommendations

**Document Type:** Requirements & Feature Specification  
**Version:** 1.0  
**Date:** March 13, 2026  
**Purpose:** Transform basic admin portal into comprehensive operations management system

---

## Current State Analysis

### What You Have Now (From Screenshot)

**✅ Basic Features Implemented:**

- Filter by User (dropdown)
- Date range filtering (Session From/To)
- Task status filtering
- Task search functionality
- Export options (JSON, CSV)
- Basic metrics cards:
  - Filtered Sessions count (5)
  - Duration Hours (0.9)
  - Open Tasks (29)
  - Completed Tasks (0)
  - Online Users (1)
  - Generated timestamp
- Session Summary by User (table)
- Recent Sessions (detailed table with login/logout/duration)
- Task Queue (table view)

**❌ Current Limitations:**

- Visually basic (looks like spreadsheet)
- No charts or graphs
- No real-time updates
- No advanced analytics
- Limited user insights
- No productivity metrics
- No alerts or notifications
- No workforce optimization features

---

## Core Purpose: Session & Hours Tracking

### Essential Features for Your Main Goal

#### 1. Enhanced Session Analytics

**Session Timeline Visualization**

Feature: Interactive timeline showing login/logout patterns

- Horizontal bar chart per user
- Color-coded by activity type (active/idle/break)
- Drill-down to specific sessions
- Visual gaps show break periods

**Idle Time Detection**

```
Feature: Track active vs idle time within sessions
- Mouse/keyboard activity monitoring
- Auto-detect idle after 5 minutes
- Separate active hours from total hours
- Idle time highlighted in orange
```

**Session Comparison Charts**
```
- Bar chart: Daily hours per user (last 7/30 days)
- Line chart: Trend over time
- Heatmap: Peak activity hours (day × hour grid)
- Pie chart: Time distribution by user
```

#### 2. Advanced Hours Reporting

**Timesheet Generation**
```
Feature: Auto-generate professional timesheets
- Weekly/Monthly/Custom range
- Grouped by user and date
- Total hours, overtime, breaks
- Export to PDF with company header
- Approval workflow (pending/approved/rejected)
```

**Billable Hours Tracking** (If applicable)
```
- Mark sessions as billable/non-billable
- Client-specific time allocation
- Rate per hour configuration
- Revenue calculation
- Invoice integration
```

**Attendance Summary**
```
- Days worked vs days available
- Punctuality metrics (late logins)
- Absence tracking
- Leave integration
- Compliance reporting
```

---

## Category 1: Advanced Analytics & Insights

### Productivity Metrics

**Task Completion Rate**
```
Metric: Tasks completed per hour worked
- Formula: Completed Tasks / Total Hours
- Per user comparison
- Trend over time (improving/declining)
- Benchmarking against team average
```

**Velocity Tracking**
```
- Story points per sprint (if using agile)
- Tasks completed per day
- Average task completion time
- Backlog reduction rate
```

**Efficiency Score**
```
Composite metric combining:
- Session hours worked
- Tasks completed
- Task priority (high = more weight)
- Deadline adherence
- Active time percentage
```

### Workforce Analytics

**Team Performance Dashboard**
```
- Top performers (leaderboard)
- Most improved user (week-over-week)
- Consistent performers (low variance)
- At-risk users (low hours, low output)
- Capacity utilization (hours vs availability)
```

**Work Pattern Analysis**
```
- Most productive hours (per user)
- Best days for focused work
- Context switching frequency
- Multi-tasking detection
- Focus time vs meeting time
```

**Collaboration Metrics**
```
- Tasks with multiple assignees
- Handoff frequency (status changes)
- Communication patterns (if integrated)
- Blocking task identification
```

---

## Category 2: Real-Time Monitoring

### Live Activity Dashboard

**Online User Panel**
```
Enhancement: Rich presence information
- Avatar + name + status dot
- Current task they're working on
- Time since last activity
- Current browser/device/location
- "Away" detection (>15 min idle)
```

**Active Tasks Map**
```
Visual: Kanban-style board showing:
- Which tasks are "in progress" right now
- Who's working on what (user avatar on card)
- Task aging (color intensity by wait time)
- Bottleneck detection (tasks stuck in one status)
```

**Live Metrics Ticker**
```
Auto-refreshing counters (every 30s):
- Total hours logged today (all users)
- Tasks completed today
- Currently online users
- Average session duration today
```

### Alerts & Notifications

**Threshold-Based Alerts**
```
- User hasn't logged in today (by 11 AM)
- Session duration exceeds 10 hours (overtime alert)
- Task overdue with no recent activity
- User logged out without completing tasks
- Unusual login time (outside work hours)
```

**Anomaly Detection**
```
- Sudden drop in user productivity
- Abnormally short sessions (< 30 min)
- No tasks completed despite hours logged
- Login from new location/device
```

---

## Category 3: Advanced Filtering & Search

### Smart Filters

**Preset Filter Templates**
```
Quick filters (1-click):
- "Show Underperformers" (low hours + low tasks)
- "Overtime Workers" (>40 hours/week)
- "At Risk Tasks" (overdue + high priority)
- "Today's Active Users"
- "Long Sessions" (>6 hours straight)
```

**Multi-Dimensional Filtering**
```
Combine filters with AND/OR logic:
- User: Eshwar AND Status: Completed AND Date: Last week
- (Status: Overdue OR Priority: High) AND Staff: Any
```

**Saved Filter Sets**
```
- Save frequently used filter combinations
- Name them ("Weekly Review", "Client XYZ Tasks")
- Share with other admins
- Schedule automatic reports
```

### Advanced Search

**Full-Text Search**
```
Search across:
- Task names and descriptions
- Client names
- Session metadata (browser, location)
- User notes
```

**Fuzzy Search**
```
- Autocomplete suggestions
- Typo tolerance ("Eswar" matches "Eshwar")
- Synonym matching
```

---

## Category 4: Reporting & Exports

### Report Templates

**Pre-Built Reports**
```
1. Weekly Team Summary
   - Total hours by user
   - Task completion rate
   - Top 3 performers
   - Overdue tasks count

2. Monthly Attendance Report
   - Days worked per user
   - Total hours per user
   - Average daily hours
   - Absence days

3. Client Activity Report
   - Hours spent per client
   - Tasks completed per client
   - Revenue by client (if billable)
   - Client satisfaction score

4. Productivity Trends Report
   - 3-month comparison
   - YoY growth
   - Seasonal patterns
   - Forecast for next month
```

**Custom Report Builder**
```
Drag-and-drop interface:
- Select metrics (hours, tasks, users)
- Choose date range
- Group by (user, client, status, priority)
- Add filters
- Pick visualization (table, chart, graph)
- Save template for reuse
```

### Export Options

**Enhanced Export Formats**
```
Beyond CSV/JSON:
- PDF with charts (professional formatting)
- Excel with pivot tables and formulas
- Google Sheets (live sync)
- PowerPoint slides (for presentations)
- Email summary (scheduled digest)
```

**Scheduled Reports**
```
- Auto-generate every Monday 9 AM
- Email to stakeholders
- Slack/Teams integration
- Save to Google Drive/Dropbox
```

---

## Category 5: User Management

### User Profiles & Settings

**Enhanced User Profiles**
```
Per-user pages showing:
- Profile photo and bio
- Work hours (start/end time)
- Time zone
- Skills and expertise
- Task history (all completed tasks)
- Performance rating (1-5 stars)
- Manager/team assignment
```

**Role-Based Access Control (RBAC)**
```
Roles:
- Super Admin (full access)
- Manager (view team, edit tasks)
- User (view own data only)
- Client (view their tasks only)
- Read-Only (reports only)
```

**User Onboarding**
```
- Invite users via email
- Auto-generate temporary password
- Force password change on first login
- Welcome tutorial/walkthrough
- Assign to team/manager
```

---

## Category 6: Task Management Enhancements

### Advanced Task Features

**Task Dependencies**
```
- Link tasks (Task B starts after Task A)
- Dependency visualization (Gantt chart)
- Critical path highlighting
- Auto-notify when blocker removed
```

**Task Templates**
```
Recurring task patterns:
- "Weekly Client Check-in"
- "Month-End Report"
- Pre-fill common fields (client, staff, priority)
```

**Bulk Operations**
```
- Multi-select tasks
- Bulk status change
- Bulk reassignment
- Bulk delete (with confirmation)
- Bulk export
```

**Task Comments & Activity Log**
```
- Internal notes on tasks
- @mention team members
- File attachments
- Edit history (who changed what, when)
```

---

## Category 7: Automation & Integrations

### Workflow Automation

**Auto-Assignment Rules**
```
- New task for "JS Roofing" → auto-assign to Mubarak
- High priority + Overdue → auto-notify manager
- Task completed → auto-move to "Follow Up" after 2 days
- User logs in → auto-create "Daily Standup" task
```

**Smart Notifications**
```
- Email digest (daily/weekly)
- Slack/Teams alerts
- In-app notifications
- SMS for urgent tasks
- Desktop push notifications
```

**Scheduled Actions**
```
- Auto-archive completed tasks after 30 days
- Auto-logout idle users after 15 minutes
- Auto-backup database daily
- Auto-generate reports every Monday
```

### Third-Party Integrations

**Communication Tools**
```
- Slack: Post updates to channels
- Microsoft Teams: Task notifications
- Email: SMTP integration for reports
- WhatsApp Business API (for client updates)
```

**Project Management**
```
- Jira: Sync tasks bidirectionally
- Trello: Import boards
- Asana: Export projects
- Monday.com: Webhook integration
```

**Accounting/Invoicing**
```
- QuickBooks: Sync billable hours
- Zoho Books: Generate invoices
- Wave: Expense tracking
```

**Calendar Integration**
```
- Google Calendar: Task deadlines as events
- Outlook: Meeting time blocking
- iCal: Export task schedule
```

---

## Category 8: Visual Design Improvements

### UI/UX Enhancements

**Modern Dashboard Layout**
```
Suggested sections (top to bottom):
1. Header: Logo, User avatar, Notifications bell, Settings
2. Quick Stats Bar: 5-6 key metrics with icons and colors
3. Main Content Area: Tabbed interface
   - Tab 1: Overview (charts and graphs)
   - Tab 2: Sessions (detailed table)
   - Tab 3: Tasks (Kanban/List view)
   - Tab 4: Users (team directory)
   - Tab 5: Reports (templates and exports)
4. Sidebar: Filters (collapsible)
5. Footer: Last updated, Help link
```

**Chart & Graph Library**
```
Recommended visualizations:
- Donut chart: Task status distribution
- Bar chart: Hours by user (horizontal)
- Line chart: Daily task completion trend
- Heatmap: Activity by hour and day
- Gauge: Capacity utilization (0-100%)
- Area chart: Cumulative hours over month
```

**Color Coding System**
```
Status colors:
- New: Blue (#3B82F6)
- In Progress: Yellow (#F59E0B)
- Waiting: Orange (#F97316)
- Completed: Green (#10B981)
- Overdue: Red (#EF4444)

Priority colors:
- High: Red border
- Medium: Yellow border
- Low: Gray border
```

**Data Tables Enhancements**
```
Features:
- Sortable columns (click header)
- Resizable columns (drag border)
- Column visibility toggle
- Row hover highlight
- Sticky header on scroll
- Pagination controls (10/25/50/100 rows)
- Row selection checkboxes
- Inline editing (double-click cell)
```

**Responsive Mobile View**
```
Mobile optimizations:
- Hamburger menu for navigation
- Stacked cards (not tables)
- Swipe gestures (left = delete, right = complete)
- Touch-friendly buttons (44px minimum)
- Bottom sheet filters (not sidebar)
```

---

## Category 9: Compliance & Audit

### Data Governance

**Audit Logs**
```
Track all admin actions:
- Who viewed which report (timestamp)
- Who edited task X (before/after values)
- Who exported data (IP address logged)
- Who deleted user Y (with reason)
- Failed login attempts
```

**GDPR Compliance**
```
Features:
- User consent tracking
- Data export request (JSON format)
- Right to deletion (anonymize user data)
- Data retention policies (auto-delete after N years)
- Privacy policy acceptance log
```

**Security Features**
```
- Two-factor authentication (2FA)
- IP whitelisting (restrict admin access)
- Session timeout (auto-logout after 30 min)
- Password complexity requirements
- Brute-force protection (lock after 5 failed logins)
```

---

## Category 10: AI & Predictive Features

### Smart Insights

**Predictive Analytics**
```
- Forecast: "User X likely to miss deadline for Task Y"
- Recommendation: "Reassign Task Z to free up User A"
- Alert: "Project ABC trending 20% over budget"
- Suggestion: "Hire contractor for peak workload next month"
```

**Natural Language Queries**
```
Ask questions in plain English:
- "How many hours did Sudharshan work last week?"
- "Show me overdue tasks for JS Roofing"
- "Who is the most productive user this month?"
- AI generates SQL query and displays results
```

**Anomaly Detection**
```
ML model flags:
- User suddenly working unusual hours
- Task taking 3x longer than similar tasks
- Client not responding for 10+ days
- Session durations deviating from baseline
```

---

## Priority Ranking: What to Build First

### Phase 1: Must-Have (Weeks 1-2)

**Highest Impact for Your Core Goal:**
1. ✅ Enhanced session timeline visualization
2. ✅ Idle time detection (active vs total hours)
3. ✅ Daily/weekly hours chart per user
4. ✅ Timesheet export (PDF)
5. ✅ Session comparison charts
6. ✅ Real-time online user panel with current task
7. ✅ Alert: User hasn't logged in today

### Phase 2: High-Value (Weeks 3-4)

**Productivity & Monitoring:**
8. Task completion rate metric
9. Efficiency score per user
10. Work pattern analysis (peak hours heatmap)
11. Preset filter templates
12. Weekly team summary report
13. Task dependencies visualization
14. Bulk task operations

### Phase 3: Nice-to-Have (Weeks 5-8)

**Advanced Features:**
15. Custom report builder
16. Scheduled reports (email digest)
17. Slack/Teams integration
18. User profiles with performance rating
19. Task templates
20. Advanced search with autocomplete
21. Mobile-responsive design

### Phase 4: Future Enhancements (Months 3+)

**Scaling & Intelligence:**
22. RBAC (role-based access)
23. Workflow automation rules
24. Predictive analytics
25. Natural language queries
26. Third-party integrations (Jira, QuickBooks)
27. Audit logs and compliance

---

## Recommended Features Summary

### Top 10 for Your Admin Portal

Based on your goal of tracking login hours and session statements, prioritize these:

1. **Session Timeline Chart** - Visual timeline showing login/logout bars per user
2. **Active vs Idle Time** - Separate productive hours from total hours
3. **Daily Hours Bar Chart** - Compare users side-by-side
4. **Timesheet Generator** - Export professional PDF timesheets
5. **Peak Activity Heatmap** - Day × Hour grid showing busiest times
6. **Real-Time "Who's Working Now"** - Live dashboard with current tasks
7. **Session Alerts** - Notify if user hasn't logged in or working overtime
8. **Efficiency Score** - Composite metric (hours + tasks + quality)
9. **Week-over-Week Trend** - Line chart showing productivity changes
10. **One-Click Reports** - Pre-built templates ("Weekly Summary", "Monthly Attendance")

---

## Wireframe Suggestions

### Improved Admin Portal Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ WeRunOps Admin Portal          🔔 3 Alerts    👤 Admin    ⚙️       │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Filters: [All Users ▾] [📅 Mar 1-10] [All Statuses ▾] [🔍 Search]│
│                                                                    │
├─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐      │
│ 📊 TOTAL│ ⏱️ ACTIVE│ 💤 IDLE │ ✅ TASKS│ 🟢 ONLINE│ 📈 EFFICIENCY │
│  125.5h │   98.2h  │  27.3h  │   47    │    2     │    87%       │
└─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘      │
│                                                                    │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ 📊 DAILY HOURS BY USER                                      │   │
│ │ ┌──────────────────────────────────────────────────────┐   │   │
│ │ │ Eshwar     ████████████ 12.5h                        │   │   │
│ │ │ Pritheesw  ██████████ 10.2h                          │   │   │
│ │ │ Sudhar     █████████ 9.8h                            │   │   │
│ │ └──────────────────────────────────────────────────────┘   │   │
│ └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│ ┌────────────────────────┬────────────────────────────────────┐  │
│ │ 📈 PRODUCTIVITY TREND  │ 🔥 ACTIVITY HEATMAP                │  │
│ │ [Line chart: 30 days]  │ [Day × Hour grid with colors]      │  │
│ └────────────────────────┴────────────────────────────────────┘  │
│                                                                    │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ 🕐 RECENT SESSIONS                         [Export CSV ▾]     │ │
│ ├────┬──────┬─────────────┬─────────────┬─────────┬──────────┐ │
│ │ ID │ User │ Login       │ Logout      │ Duration│ Efficiency│ │
│ ├────┼──────┼─────────────┼─────────────┼─────────┼──────────┤ │
│ │sess│Eshwar│Mar 13, 2:16p│Mar 13, 2:16p│  74 min │   92%    │ │
│ │cfd0│Eshwar│Mar 13, 2:12p│Mar 13, 2:16p│ 195 min │   88%    │ │
│ │82ef│Eshwar│Mar 13, 1:02p│Mar 13, 1:38p│2797 min │   N/A    │ │
│ └────┴──────┴─────────────┴─────────────┴─────────┴──────────┘ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│ 🟢 Currently Online: Eshwar (working on "Lock contention test")   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Key Visual Improvements

1. **Top Metrics Bar** - Large, colorful cards with icons
2. **Bar Chart** - Horizontal bars showing daily hours per user
3. **Line Chart** - 30-day trend showing productivity changes
4. **Heatmap** - Visual calendar-style grid (dark = more activity)
5. **Enhanced Table** - Add "Efficiency" column, color-coded rows
6. **Live Status Banner** - Show who's online and their current task

---

## Technical Implementation Notes

### Chart Library Recommendation

**Chart.js** (Already using in main app)
```javascript
// Example: Daily Hours Bar Chart
new Chart(ctx, {
  type: 'bar',
  data: {
    labels: ['Eshwar', 'Pritheeswarar', 'Sudhar'],
    datasets: [{
      label: 'Active Hours',
      data: [8.5, 7.2, 6.8],
      backgroundColor: '#10B981'
    }, {
      label: 'Idle Hours',
      data: [2.0, 1.5, 1.2],
      backgroundColor: '#F59E0B'
    }]
  },
  options: {
    indexAxis: 'y',  // Horizontal bars
    scales: {
      x: { stacked: true },
      y: { stacked: true }
    }
  }
});
```

### Real-Time Updates

**Supabase Realtime Subscription**
```javascript
// Listen to sessions table changes
supabase
  .channel('sessions')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'sessions'
  }, (payload) => {
    if (payload.eventType === 'INSERT') {
      // New session started - update "Currently Online"
      updateOnlineUsers();
    }
    if (payload.eventType === 'UPDATE' && payload.new.logout_time) {
      // Session ended - recalculate hours
      refreshMetrics();
    }
  })
  .subscribe();
```

### Session Analytics Query

**PostgreSQL Query for Hours Report**
```sql
-- Daily hours by user for date range
SELECT 
  u.username,
  DATE(s.login_time) as work_date,
  SUM(s.duration_minutes) / 60.0 as total_hours,
  SUM(CASE WHEN s.is_active THEN s.duration_minutes ELSE 0 END) / 60.0 as active_hours,
  SUM(CASE WHEN NOT s.is_active THEN s.duration_minutes ELSE 0 END) / 60.0 as idle_hours,
  COUNT(*) as session_count
FROM users u
JOIN sessions s ON u.id = s.user_id
WHERE s.login_time BETWEEN '2026-03-01' AND '2026-03-10'
  AND s.logout_time IS NOT NULL
GROUP BY u.username, DATE(s.login_time)
ORDER BY work_date DESC, total_hours DESC;
```

---

## Cost Implications

All recommended features stay within **₹0 budget** if built on:
- **Vercel** (serverless API endpoints - free tier)
- **Supabase** (PostgreSQL + realtime - free tier)
- **GitHub Pages** (static frontend - free)
- **Chart.js** (open-source charting - free)
- **Tailwind CSS** (styling - free)

**Only if scaling beyond 50 users:**
- Supabase Pro: ₹1,590/month ($20)
- Vercel Pro: ₹1,590/month ($20)

---

## Next Steps

### Immediate Actions (This Week)

1. **Prioritize Top 5 Features** from Phase 1 list above
2. **Design Mockups** for new dashboard layout (use Figma or Excalidraw)
3. **Backend API Endpoints** needed:
   - `GET /api/analytics/daily-hours?start=2026-03-01&end=2026-03-10`
   - `GET /api/analytics/activity-heatmap?user=all&weeks=4`
   - `GET /api/analytics/efficiency-score?user=Eshwar`
   - `GET /api/presence/current-tasks` (realtime)
4. **Database Schema Updates**:
   - Add `is_active` column to sessions table (for idle tracking)
   - Add `current_task_id` to online_users table
   - Create materialized view for performance metrics
5. **Frontend Components**:
   - `DailyHoursChart.js` (Chart.js bar chart)
   - `ActivityHeatmap.js` (custom grid component)
   - `LiveUserPanel.js` (realtime subscription)
   - `TimesheetExport.js` (PDF generation using jsPDF)

### Questions to Clarify

Before building, confirm:
1. **Idle Time Detection**: Should mouse/keyboard activity be tracked? (Privacy concern)
2. **Efficiency Score Formula**: What factors to include? (hours, tasks, quality?)
3. **Alert Thresholds**: What's considered "overtime"? (>8 hours/day? >40/week?)
4. **Report Frequency**: Who receives scheduled reports? (admins only? managers?)
5. **Mobile Priority**: Do admins need mobile access? (affects UI design)

---

## Conclusion

Your current admin portal is **functionally working but visually basic**. The recommended enhancements will transform it into a **comprehensive workforce analytics system** that not only tracks hours but provides actionable insights for productivity optimization.

**Key Focus Areas:**
✅ Enhanced visualizations (charts, heatmaps, timelines)  
✅ Real-time monitoring (who's working now)  
✅ Predictive alerts (missed logins, overtime)  
✅ Professional reporting (timesheet PDFs, scheduled emails)  
✅ Efficiency metrics (not just hours, but impact)

**Recommended Path:** Implement Phase 1 features first (2 weeks), validate with users, then proceed to Phase 2 based on feedback.

Need detailed implementation code for any specific feature? Say **"implement [feature name]"** and I'll provide full working code.
