import { useEffect, useMemo, useState, useCallback } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { loadTasks as fetchTasks } from '../services/taskMonitoringService';

const formatDate = date => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDate = value => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const getPriorityRank = task => {
  const rawPriority = String(task?.priority || task?.type || '')
    .trim()
    .toLowerCase();

  if (rawPriority.includes('high')) {
    return 3;
  }

  if (rawPriority.includes('medium')) {
    return 2;
  }

  if (rawPriority.includes('low')) {
    return 1;
  }

  return 0;
};

export const useTaskMonitoring = () => {
  const isFocused = useIsFocused();
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [selectedDate, setSelectedDate] = useState(() =>
    formatDate(new Date()),
  );
  const [calendarMonth, setCalendarMonth] = useState(() =>
    parseDate(formatDate(new Date())),
  );
  const [tasks, setTasks] = useState([]);
  const [taskCache, setTaskCache] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const filteredTasks = useMemo(() => {
    return tasks
      .filter(task => {
      const matchesStatus =
        selectedFilter === 'All' ? true : task.status === selectedFilter;
      const matchesDate = selectedDate ? task.date === selectedDate : true;
      return matchesStatus && matchesDate;
      })
      .map((task, index) => ({ task, index }))
      .sort((left, right) => {
        const priorityDelta =
          getPriorityRank(right.task) - getPriorityRank(left.task);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }

        return left.index - right.index;
      })
      .map(entry => entry.task);
  }, [selectedFilter, selectedDate, tasks]);

  const stats = useMemo(() => {
    return {
      total: tasks.length,
      pending: tasks.filter(task => task.status === 'Pending').length,
      approved: tasks.filter(task => task.status === 'Approved').length,
      notApproved: tasks.filter(task => task.status === 'Not Approved').length,
      completed: tasks.filter(task => task.status === 'Completed').length,
    };
  }, [tasks]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = formatDate(new Date());
      const isToday = selectedDate === today;

      // Check cache for past dates
      if (!isToday && taskCache[selectedDate]) {
        setTasks(taskCache[selectedDate]);
        setLoading(false);
        return;
      }

      // Fetch from service
      const currentTasks = await fetchTasks(selectedDate);

      // Cache non-today dates
      if (!isToday) {
        setTaskCache(prev => ({
          ...prev,
          [selectedDate]: currentTasks,
        }));
      }

      setTasks(currentTasks);
    } catch (err) {
      setError(err?.message || err);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, taskCache]);

  // Load tasks when date changes
  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Clear cache when screen loses focus
  useEffect(() => {
    if (!isFocused) {
      setTaskCache({});
    }
  }, [isFocused]);

  // Clear cache on unmount (handled automatically by state reset)

  const moveCalendarMonth = offset => {
    setCalendarMonth(
      prev => new Date(prev.getFullYear(), prev.getMonth() + offset, 1),
    );
  };

  const moveCalendarYear = offset => {
    setCalendarMonth(
      prev => new Date(prev.getFullYear() + offset, prev.getMonth(), 1),
    );
  };

  const openDatePicker = () => {
    setCalendarMonth(parseDate(selectedDate));
  };

  return {
    // State
    selectedFilter,
    setSelectedFilter,
    selectedDate,
    setSelectedDate,
    calendarMonth,
    setCalendarMonth,
    datePickerOpen: null, // Managed in screen via local state
    setDatePickerOpen: null,
    filterMenuOpen: null,
    setFilterMenuOpen: null,
    selectedTask: null,
    setSelectedTask: null,
    tasks,
    taskCache,
    loading,
    error,
    // Derived
    filteredTasks,
    stats,
    // Helpers
    calendarDays: null, // Computed in screen
    priorityColor: null, // Defined in screen
    moveCalendarMonth,
    moveCalendarYear,
    openDatePicker,
    loadTasks,
  };
};
