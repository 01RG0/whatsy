package handler

import (
	"database/sql"
	"net/http"
	"sync"
	"time"
)

// AnalyticsHandler serves analytics endpoints.
type AnalyticsHandler struct {
	db *sql.DB
}

// NewAnalyticsHandler creates an AnalyticsHandler backed by db.
func NewAnalyticsHandler(db *sql.DB) *AnalyticsHandler {
	return &AnalyticsHandler{db: db}
}

type overviewResponse struct {
	InboundMessages         int           `json:"inboundMessages"`
	OutboundMessages        int           `json:"outboundMessages"`
	NewContacts             int           `json:"newContacts"`
	ActiveConversations     int           `json:"activeConversations"`
	UnassignedConversations int           `json:"unassignedConversations"`
	AvgResponseSeconds      *float64      `json:"avgResponseSeconds"`
	MessageTypes            []msgTypeStat `json:"messageTypes"`
	VolumeTrend             []trendPoint  `json:"volumeTrend"`
	PrevInboundMessages     *int          `json:"prevInboundMessages,omitempty"`
	PrevOutboundMessages    *int          `json:"prevOutboundMessages,omitempty"`
	PrevNewContacts         *int          `json:"prevNewContacts,omitempty"`
	PrevActiveConversations *int          `json:"prevActiveConversations,omitempty"`
}

type msgTypeStat struct {
	Type  string `json:"type"`
	Count int    `json:"count"`
}

type trendPoint struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

type agentStatRow struct {
	ID                   string       `json:"id"`
	Name                 string       `json:"name"`
	Avatar               string       `json:"avatar"`
	MessagesSent         int          `json:"messagesSent"`
	ConversationsHandled int          `json:"conversationsHandled"`
	AvgResponseSeconds   *float64     `json:"avgResponseSeconds"`
	ActiveHours          []activeHour `json:"activeHours"`
}

type activeHour struct {
	Hour  int `json:"hour"`
	Count int `json:"count"`
}

// parseAnalyticsRange resolves the ?range= query parameter into UTC [from, to) boundaries.
func parseAnalyticsRange(r *http.Request) (from, to time.Time) {
	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	switch r.URL.Query().Get("range") {
	case "week":
		wd := int(now.Weekday())
		if wd == 0 {
			wd = 7
		}
		from = today.AddDate(0, 0, -(wd - 1))
		to = from.AddDate(0, 0, 7)
	case "month":
		from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		to = from.AddDate(0, 1, 0)
	case "custom":
		from, _ = time.Parse("2006-01-02", r.URL.Query().Get("from"))
		parsed, err := time.Parse("2006-01-02", r.URL.Query().Get("to"))
		if err == nil {
			to = parsed.AddDate(0, 0, 1)
		}
		if from.IsZero() || to.IsZero() {
			from = today
			to = today.AddDate(0, 0, 1)
		}
	default: // "today"
		from = today
		to = today.AddDate(0, 0, 1)
	}
	return
}

// Overview handles GET /v1/analytics/overview
func (h *AnalyticsHandler) Overview(w http.ResponseWriter, r *http.Request) {
	from, to := parseAnalyticsRange(r)
	rangeParam := r.URL.Query().Get("range")
	wantPrev := rangeParam == "week" || rangeParam == "month"

	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		firstErr error
	)

	setErr := func(err error) {
		mu.Lock()
		defer mu.Unlock()
		if firstErr == nil {
			firstErr = err
		}
	}

	var resp overviewResponse
	resp.MessageTypes = []msgTypeStat{}
	resp.VolumeTrend = []trendPoint{}

	// Q1: message counts by direction
	wg.Add(1)
	go func() {
		defer wg.Done()
		rows, err := h.db.QueryContext(r.Context(),
			`SELECT direction, COUNT(*) FROM messages WHERE timestamp >= $1 AND timestamp < $2 GROUP BY direction`,
			from, to,
		)
		if err != nil {
			setErr(err)
			return
		}
		defer rows.Close()
		for rows.Next() {
			var dir string
			var cnt int
			if err := rows.Scan(&dir, &cnt); err != nil {
				setErr(err)
				return
			}
			mu.Lock()
			switch dir {
			case "inbound":
				resp.InboundMessages = cnt
			case "outbound":
				resp.OutboundMessages = cnt
			}
			mu.Unlock()
		}
		if err := rows.Err(); err != nil {
			setErr(err)
		}
	}()

	// Q2: new contacts
	wg.Add(1)
	go func() {
		defer wg.Done()
		var cnt int
		err := h.db.QueryRowContext(r.Context(),
			`SELECT COUNT(*) FROM students WHERE created_at >= $1 AND created_at < $2`,
			from, to,
		).Scan(&cnt)
		if err != nil {
			setErr(err)
			return
		}
		mu.Lock()
		resp.NewContacts = cnt
		mu.Unlock()
	}()

	// Q3: active conversations
	wg.Add(1)
	go func() {
		defer wg.Done()
		var cnt int
		err := h.db.QueryRowContext(r.Context(),
			`SELECT COUNT(DISTINCT conversation_id) FROM messages WHERE timestamp >= $1 AND timestamp < $2`,
			from, to,
		).Scan(&cnt)
		if err != nil {
			setErr(err)
			return
		}
		mu.Lock()
		resp.ActiveConversations = cnt
		mu.Unlock()
	}()

	// Q4: unassigned conversations
	wg.Add(1)
	go func() {
		defer wg.Done()
		var cnt int
		err := h.db.QueryRowContext(r.Context(),
			`SELECT COUNT(*) FROM conversations WHERE assigned_agent_id IS NULL AND last_message_at >= $1 AND last_message_at < $2`,
			from, to,
		).Scan(&cnt)
		if err != nil {
			setErr(err)
			return
		}
		mu.Lock()
		resp.UnassignedConversations = cnt
		mu.Unlock()
	}()

	// Q5: message type breakdown
	wg.Add(1)
	go func() {
		defer wg.Done()
		rows, err := h.db.QueryContext(r.Context(),
			`SELECT content_type, COUNT(*) FROM messages WHERE timestamp >= $1 AND timestamp < $2 GROUP BY content_type ORDER BY COUNT(*) DESC`,
			from, to,
		)
		if err != nil {
			setErr(err)
			return
		}
		defer rows.Close()
		var types []msgTypeStat
		for rows.Next() {
			var s msgTypeStat
			if err := rows.Scan(&s.Type, &s.Count); err != nil {
				setErr(err)
				return
			}
			types = append(types, s)
		}
		if err := rows.Err(); err != nil {
			setErr(err)
			return
		}
		mu.Lock()
		if types != nil {
			resp.MessageTypes = types
		}
		mu.Unlock()
	}()

	// Q6: volume trend day by day
	wg.Add(1)
	go func() {
		defer wg.Done()
		rows, err := h.db.QueryContext(r.Context(),
			`SELECT DATE_TRUNC('day', timestamp) AS day, COUNT(*) AS cnt
			 FROM messages WHERE timestamp >= $1 AND timestamp < $2
			 GROUP BY day ORDER BY day`,
			from, to,
		)
		if err != nil {
			setErr(err)
			return
		}
		defer rows.Close()
		var trend []trendPoint
		for rows.Next() {
			var t trendPoint
			var day time.Time
			if err := rows.Scan(&day, &t.Count); err != nil {
				setErr(err)
				return
			}
			t.Day = day.Format("2006-01-02")
			trend = append(trend, t)
		}
		if err := rows.Err(); err != nil {
			setErr(err)
			return
		}
		mu.Lock()
		if trend != nil {
			resp.VolumeTrend = trend
		}
		mu.Unlock()
	}()

	// Q7: avg first-response time
	wg.Add(1)
	go func() {
		defer wg.Done()
		var avg sql.NullFloat64
		err := h.db.QueryRowContext(r.Context(),
			`SELECT AVG(EXTRACT(EPOCH FROM (o.timestamp - i.timestamp)))
			 FROM messages i
			 JOIN LATERAL (
			   SELECT timestamp FROM messages
			   WHERE conversation_id = i.conversation_id
			     AND direction = 'outbound' AND timestamp > i.timestamp
			   ORDER BY timestamp ASC LIMIT 1
			 ) o ON true
			 WHERE i.direction = 'inbound' AND i.timestamp >= $1 AND i.timestamp < $2`,
			from, to,
		).Scan(&avg)
		if err != nil {
			setErr(err)
			return
		}
		mu.Lock()
		if avg.Valid {
			v := avg.Float64
			resp.AvgResponseSeconds = &v
		}
		mu.Unlock()
	}()

	wg.Wait()

	if firstErr != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "analytics overview"})
		return
	}

	// Previous period queries for week and month ranges
	if wantPrev {
		duration := to.Sub(from)
		prevFrom := from.Add(-duration)
		prevTo := from

		var prevWg sync.WaitGroup
		var prevInbound, prevOutbound, prevContacts, prevActive int

		prevWg.Add(1)
		go func() {
			defer prevWg.Done()
			rows, err := h.db.QueryContext(r.Context(),
				`SELECT direction, COUNT(*) FROM messages WHERE timestamp >= $1 AND timestamp < $2 GROUP BY direction`,
				prevFrom, prevTo,
			)
			if err != nil {
				return
			}
			defer rows.Close()
			for rows.Next() {
				var dir string
				var cnt int
				if rows.Scan(&dir, &cnt) != nil {
					return
				}
				switch dir {
				case "inbound":
					prevInbound = cnt
				case "outbound":
					prevOutbound = cnt
				}
			}
		}()

		prevWg.Add(1)
		go func() {
			defer prevWg.Done()
			h.db.QueryRowContext(r.Context(),
				`SELECT COUNT(*) FROM students WHERE created_at >= $1 AND created_at < $2`,
				prevFrom, prevTo,
			).Scan(&prevContacts) //nolint:errcheck — zero is a safe default
		}()

		prevWg.Add(1)
		go func() {
			defer prevWg.Done()
			h.db.QueryRowContext(r.Context(),
				`SELECT COUNT(DISTINCT conversation_id) FROM messages WHERE timestamp >= $1 AND timestamp < $2`,
				prevFrom, prevTo,
			).Scan(&prevActive) //nolint:errcheck — zero is a safe default
		}()

		prevWg.Wait()

		resp.PrevInboundMessages = &prevInbound
		resp.PrevOutboundMessages = &prevOutbound
		resp.PrevNewContacts = &prevContacts
		resp.PrevActiveConversations = &prevActive
	}

	writeJSON(w, http.StatusOK, resp)
}

// AgentStats handles GET /v1/analytics/agents
func (h *AnalyticsHandler) AgentStats(w http.ResponseWriter, r *http.Request) {
	from, to := parseAnalyticsRange(r)

	type agentKey = string
	statsMap := make(map[agentKey]*agentStatRow)

	// Q1: messages sent + conversations handled
	rows, err := h.db.QueryContext(r.Context(),
		`SELECT a.id::text, a.name, a.avatar,
		        COALESCE(m.cnt, 0) AS messages_sent,
		        COALESCE(c.convs, 0) AS conversations_handled
		 FROM agents a
		 LEFT JOIN (
		   SELECT sent_by_agent_id, COUNT(*) AS cnt FROM messages
		   WHERE direction='outbound' AND sent_by_agent_id IS NOT NULL
		     AND timestamp >= $1 AND timestamp < $2
		   GROUP BY sent_by_agent_id
		 ) m ON m.sent_by_agent_id = a.id
		 LEFT JOIN (
		   SELECT assigned_agent_id, COUNT(DISTINCT id) AS convs FROM conversations
		   WHERE updated_at >= $1 AND updated_at < $2 AND assigned_agent_id IS NOT NULL
		   GROUP BY assigned_agent_id
		 ) c ON c.assigned_agent_id = a.id
		 ORDER BY a.name`,
		from, to,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "analytics agents"})
		return
	}
	defer rows.Close()
	var orderedIDs []string
	for rows.Next() {
		var s agentStatRow
		if err := rows.Scan(&s.ID, &s.Name, &s.Avatar, &s.MessagesSent, &s.ConversationsHandled); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "analytics agents"})
			return
		}
		s.ActiveHours = []activeHour{}
		statsMap[s.ID] = &s
		orderedIDs = append(orderedIDs, s.ID)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "analytics agents"})
		return
	}

	// Q2: avg response time per agent
	rows2, err := h.db.QueryContext(r.Context(),
		`SELECT o.sent_by_agent_id::text,
		        AVG(EXTRACT(EPOCH FROM (o.timestamp - prev.timestamp))) AS avg_secs
		 FROM messages o
		 JOIN LATERAL (
		   SELECT timestamp FROM messages i
		   WHERE i.conversation_id = o.conversation_id
		     AND i.direction = 'inbound' AND i.timestamp < o.timestamp
		   ORDER BY i.timestamp DESC LIMIT 1
		 ) prev ON true
		 WHERE o.direction = 'outbound' AND o.sent_by_agent_id IS NOT NULL
		   AND o.timestamp >= $1 AND o.timestamp < $2
		 GROUP BY o.sent_by_agent_id`,
		from, to,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "analytics agents"})
		return
	}
	defer rows2.Close()
	for rows2.Next() {
		var agentID string
		var avg sql.NullFloat64
		if err := rows2.Scan(&agentID, &avg); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "analytics agents"})
			return
		}
		if s, ok := statsMap[agentID]; ok && avg.Valid {
			v := avg.Float64
			s.AvgResponseSeconds = &v
		}
	}
	if err := rows2.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "analytics agents"})
		return
	}

	// Q3: active hours per agent
	rows3, err := h.db.QueryContext(r.Context(),
		`SELECT sent_by_agent_id::text, EXTRACT(HOUR FROM timestamp)::int AS hour, COUNT(*) AS cnt
		 FROM messages
		 WHERE direction='outbound' AND sent_by_agent_id IS NOT NULL
		   AND timestamp >= $1 AND timestamp < $2
		 GROUP BY sent_by_agent_id, hour
		 ORDER BY sent_by_agent_id, hour`,
		from, to,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "analytics agents"})
		return
	}
	defer rows3.Close()
	for rows3.Next() {
		var agentID string
		var ah activeHour
		if err := rows3.Scan(&agentID, &ah.Hour, &ah.Count); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "analytics agents"})
			return
		}
		if s, ok := statsMap[agentID]; ok {
			s.ActiveHours = append(s.ActiveHours, ah)
		}
	}
	if err := rows3.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "analytics agents"})
		return
	}

	// Build ordered result slice
	result := make([]agentStatRow, 0, len(orderedIDs))
	for _, id := range orderedIDs {
		result = append(result, *statsMap[id])
	}

	writeJSON(w, http.StatusOK, result)
}
