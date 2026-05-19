import { Request, Response, NextFunction } from 'express'

export const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
	root: [
		'users:view', 'users:invite', 'users:edit', 'users:delete',
		'leads:view', 'leads:create', 'leads:edit', 'leads:delete',
		'workflows:view', 'workflows:manage',
		'templates:view', 'templates:manage',
		'settings:view', 'settings:manage',
		'logs:view',
	],
	admin: [
		'users:view', 'users:invite', 'users:edit', 'users:delete',
		'leads:view', 'leads:create', 'leads:edit', 'leads:delete',
		'workflows:view', 'workflows:manage',
		'templates:view', 'templates:manage',
		'settings:view',
		'logs:view',
	],
	manager: [
		'leads:view', 'leads:create', 'leads:edit',
		'workflows:view',
		'templates:view',
		'settings:view',
		'logs:view',
	],
	member: [
		'leads:view',
		'templates:view',
		'logs:view',
	],
}

const ROLE_LEVEL: Record<string, number> = {
	root: 4,
	admin: 3,
	manager: 2,
	member: 1,
}

export const getRoleLevel = (role: string): number => ROLE_LEVEL[role] ?? 0

export const getEffectivePermissions = (role: string, permissions: string[]): string[] =>
	permissions.length ? permissions : (ROLE_DEFAULT_PERMISSIONS[role] ?? [])

export function requirePermission(permission: string) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const user = req.user
		if (!user) {
			res.status(401).json({ success: false, message: 'Not authenticated' })
			return
		}
		const effective = getEffectivePermissions(user.role, user.permissions ?? [])
		if (!effective.includes(permission)) {
			res.status(403).json({ success: false, message: 'Forbidden', code: 'FORBIDDEN' })
			return
		}
		next()
	}
}

export default requirePermission
