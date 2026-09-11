import type { GalGroup, NewGalGroup } from '../../core/types';
import { createProjectContext } from '../../core/project/store';
import { saveGroup, setGroupProjectId } from '../../core/group/store';

/**
 * Saves a GAL group and, on first save, creates the deepseek-pp project that
 * acts as the group's shared context carrier (project memories + project
 * instructions). The DeepSeek session itself stays the chat transport; the
 * project only supplies "what happened in the group" to every member.
 */
export async function saveGroupWithSharedProject(group: NewGalGroup): Promise<GalGroup> {
  const saved = await saveGroup(group);
  if (saved.projectId) return saved;
  const project = await createProjectContext({
    name: saved.name,
    description: saved.description ?? '',
    instructions: saved.instructions ?? '',
  });
  return setGroupProjectId(saved.id, project.id);
}
