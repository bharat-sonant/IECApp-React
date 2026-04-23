#!/usr/bin/env python3
import re

with open('src/services/taskMonitoringService.js', 'r') as f:
    content = f.read()

# Replace function signature
content = content.replace("const buildStorageUrl = (path, type = 'media', taskData = null) => {", "const buildStorageUrl = (path, type = 'media', taskItem = null) => {")

# Replace internal references
content = re.sub(r'taskData\?\.userId', 'taskItem?.userId', content)
content = re.sub(r'extractUserId\(taskData\)', 'taskItem?.id', content)
content = re.sub(r'taskData\?\.mediaKey', 'taskItem?.mediaKey', content)
content = re.sub(r'taskData\?\.taskKey', 'taskItem?.taskKey', content)
content = re.sub(r'taskData\?\.mediaCount', 'taskItem?.mediaCount', content)
content = re.sub(r'getDateFromTaskData\(taskData\)', 'getDateFromTaskData(taskItem)', content)

# Replace the calls - keep using item as the taskItem since item contains all needed data
content = content.replace(".map(k => buildStorageUrl(item[k], 'image', item))", ".map(k => buildStorageUrl(item[k], 'image', item))")
content = content.replace(".map(k => buildStorageUrl(item[k], 'video', item))", ".map(k => buildStorageUrl(item[k], 'video', item))")

with open('src/services/taskMonitoringService.js', 'w') as f:
    f.write(content)

print('Done')