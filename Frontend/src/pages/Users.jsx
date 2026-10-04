import { useEffect, useMemo, useState } from 'react';
import { Check, Edit2, KeyRound, Plus, RefreshCcw, Save, Trash2, UserRound, X } from 'lucide-react';

import api from '../api/axios';
import ConfirmModal from '../components/ConfirmModal';
import Table from '../components/Table';

const filterOptions = [
  { label: 'All users', value: 'all' },
  { label: 'Active users', value: 'active' },
  { label: 'Inactive users', value: 'inactive' },
];

const roleOptions = ['Admin', 'Staff'];

const JAMSTART_DOMAIN = '@jamstart.com';

const normalizeNamePart = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const buildGeneratedCredentials = (firstName, lastName) => {
  const normalizedFirstName = normalizeNamePart(firstName);
  const normalizedLastName = normalizeNamePart(lastName);

  if (!normalizedFirstName || !normalizedLastName) {
    return { email: '', password: '' };
  }

  return {
    email: `${normalizedFirstName[0]}${normalizedLastName}${JAMSTART_DOMAIN}`,
    password: `${normalizedFirstName[0]}${normalizedLastName}1234`,
  };
};

const emptyUserForm = {
  first_name: '',
  middle_name: '',
  last_name: '',
  suffix: '',
  email: '',
  password: '',
  role: 'Staff',
};

const formatDate = (value) =>
  new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

const formatName = (user) =>
  [user.first_name, user.middle_name, user.last_name, user.suffix].filter(Boolean).join(' ') || '—';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [searchValue, setSearchValue] = useState('');
  const [filterValue, setFilterValue] = useState('all');
  const [loading, setLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mode, setMode] = useState('create');
  const [editingUserId, setEditingUserId] = useState(null);
  const [formData, setFormData] = useState(emptyUserForm);
  const [passwordRequests, setPasswordRequests] = useState([]);
  const [selectedPasswordRequest, setSelectedPasswordRequest] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resolvingPasswordRequest, setResolvingPasswordRequest] = useState(false);
  const [confirmState, setConfirmState] = useState({
    open: false,
    user: null,
    action: null,
  });

  useEffect(() => {
    let active = true;

    const loadUsers = async () => {
      setLoading(true);
      setError('');

      try {
        const params = {};

        if (filterValue === 'active') {
          params.status = 'active';
        }

        if (filterValue === 'inactive') {
          params.status = 'inactive';
        }

        const response = await api.get('/users', { params });

        if (active) {
          setUsers(response.data.users || []);
        }
      } catch {
        if (active) {
          setError('Unable to load users right now.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadUsers();

    return () => {
      active = false;
    };
  }, [filterValue]);

  useEffect(() => {
    let active = true;

    api.get('/users/password-change-requests')
      .then((response) => {
        if (active) setPasswordRequests(response.data.requests || []);
      })
      .catch(() => {
        if (active) setError('Unable to load password change requests right now.');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!success) {
      return undefined;
    }

    const timer = window.setTimeout(() => setSuccess(''), 2500);
    return () => window.clearTimeout(timer);
  }, [success]);

  const visibleUsers = useMemo(() => {
    const query = searchValue.trim().toLowerCase();

    if (!query) {
      return users;
    }

    return users.filter((user) => {
      const searchable = [
        user.id,
        user.first_name,
        user.middle_name,
        user.last_name,
        user.suffix,
        user.email,
        user.role,
        user.isActive ? 'active' : 'inactive',
        formatName(user),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [searchValue, users]);

  const openCreateModal = () => {
    setMode('create');
    setEditingUserId(null);
    setFormData(emptyUserForm);
    setError('');
    setIsModalOpen(true);
  };

  const openEditModal = (user) => {
    setMode('edit');
    setEditingUserId(user.id);
    setFormData({
      first_name: user.first_name || '',
      middle_name: user.middle_name || '',
      last_name: user.last_name || '',
      suffix: user.suffix || '',
      email: user.email || '',
      password: '',
      role: user.role || 'Staff',
    });
    setError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (saving) {
      return;
    }

    setIsModalOpen(false);
  };

  const handleInputChange = (field) => (event) => {
    const value = event.target.value;

    setFormData((current) => {
      const nextState = {
        ...current,
        [field]: value,
      };

      if (mode === 'create' && (field === 'first_name' || field === 'last_name')) {
        const generated = buildGeneratedCredentials(
          field === 'first_name' ? value : nextState.first_name,
          field === 'last_name' ? value : nextState.last_name
        );

        nextState.email = generated.email;
        nextState.password = generated.password;
      }

      return nextState;
    });
  };

  const refreshUsers = async () => {
    const params = {};

    if (filterValue === 'active') {
      params.status = 'active';
    }

    if (filterValue === 'inactive') {
      params.status = 'inactive';
    }

    const response = await api.get('/users', { params });
    setUsers(response.data.users || []);
  };

  const handleSaveUser = async (event) => {
    event.preventDefault();

    if (!formData.first_name.trim() || !formData.last_name.trim() || !formData.email.trim()) {
      setError('First name, last name, and email are required.');
      return;
    }

    if (mode === 'create' && formData.password.trim().length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    const generatedCredentials =
      mode === 'create' ? buildGeneratedCredentials(formData.first_name, formData.last_name) : null;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      if (mode === 'create') {
        await api.post('/auth/register', {
          first_name: formData.first_name.trim(),
          middle_name: formData.middle_name.trim() || null,
          last_name: formData.last_name.trim(),
          suffix: formData.suffix.trim() || null,
          email: generatedCredentials?.email || formData.email.trim(),
          password: generatedCredentials?.password || formData.password,
        });
        setSuccess('User created successfully.');
      } else {
        await api.put(`/users/${editingUserId}`, {
          first_name: formData.first_name.trim(),
          middle_name: formData.middle_name.trim() || null,
          last_name: formData.last_name.trim(),
          suffix: formData.suffix.trim() || null,
          email: formData.email.trim(),
          role: formData.role,
        });
        setSuccess('User updated successfully.');
      }

      await refreshUsers();
      setIsModalOpen(false);
      setFormData(emptyUserForm);
    } catch (saveError) {
      setError(saveError?.response?.data?.error || 'Unable to save user.');
    } finally {
      setSaving(false);
    }
  };

  const handleResolvePasswordRequest = async (event) => {
    event.preventDefault();

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setResolvingPasswordRequest(true);
    setError('');
    setSuccess('');

    try {
      await api.put(`/users/password-change-requests/${selectedPasswordRequest.id}/resolve`, { newPassword });
      setPasswordRequests((current) => current.filter((request) => request.id !== selectedPasswordRequest.id));
      setSelectedPasswordRequest(null);
      setNewPassword('');
      setSuccess('Password updated and request resolved.');
    } catch (resolveError) {
      setError(resolveError?.response?.data?.error || 'Unable to update the password.');
    } finally {
      setResolvingPasswordRequest(false);
    }
  };

  const openConfirmModal = (user) => {
    setError('');
    setConfirmState({
      open: true,
      user,
      action: user.isActive ? 'archive' : 'restore',
    });
  };

  const closeConfirmModal = () => {
    if (mutatingId) {
      return;
    }

    setConfirmState({
      open: false,
      user: null,
      action: null,
    });
  };

  const handleConfirmAction = async () => {
    const targetUser = confirmState.user;

    if (!targetUser) {
      return;
    }

    setMutatingId(targetUser.id);
    setError('');
    setSuccess('');

    try {
      if (confirmState.action === 'restore') {
        await api.put(`/users/${targetUser.id}/restore`);
        setSuccess('User restored successfully.');
      } else {
        await api.put(`/users/${targetUser.id}/archive`);
        setSuccess('User archived successfully.');
      }

      await refreshUsers();
      setConfirmState({
        open: false,
        user: null,
        action: null,
      });
    } catch {
      setError(
        confirmState.action === 'restore' ? 'Unable to restore this user.' : 'Unable to archive this user.'
      );
    } finally {
      setMutatingId(null);
    }
  };

  const columns = [
    {
      key: 'id',
      header: 'ID',
      render: (user) => <span className="font-medium text-emerald-950">{user.id}</span>,
    },
    {
      key: 'first_name',
      header: 'First name',
      render: (user) => user.first_name,
    },
    {
      key: 'middle_name',
      header: 'Middle name',
      render: (user) => user.middle_name || '—',
    },
    {
      key: 'last_name',
      header: 'Last name',
      render: (user) => user.last_name,
    },
    {
      key: 'suffix',
      header: 'Suffix',
      render: (user) => user.suffix || '—',
    },
    {
      key: 'email',
      header: 'Email',
      render: (user) => <span className="truncate">{user.email}</span>,
    },
    {
      key: 'role',
      header: 'Role',
      render: (user) => (
        <span className="inline-flex rounded-full bg-lime-100 px-3 py-1 text-xs font-medium text-lime-900">
          {user.role}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created at',
      render: (user) => formatDate(user.createdAt),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (user) => (
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
            user.isActive ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'
          }`}
        >
          {user.isActive ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (user) => (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => openEditModal(user)}
            title="Edit user"
            aria-label={`Edit ${formatName(user)}`}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-900/10 bg-white text-emerald-900/70 transition hover:border-emerald-900/15 hover:bg-emerald-50 hover:text-emerald-950"
          >
            <Edit2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => openConfirmModal(user)}
            disabled={mutatingId === user.id}
            title={user.isActive ? 'Archive user' : 'Restore user'}
            aria-label={`${user.isActive ? 'Archive' : 'Restore'} ${formatName(user)}`}
            className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-900/10 bg-white text-emerald-900/70 transition disabled:cursor-not-allowed disabled:opacity-40 ${
              user.isActive
                ? 'hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700'
                : 'hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-950'
            }`}
          >
            {user.isActive ? <Trash2 className="h-4 w-4" /> : <RefreshCcw className="h-4 w-4" />}
          </button>
        </div>
      ),
    },
  ];

  return (
    <section className="grid gap-6">
      <div className="rounded-[1.5rem] border border-emerald-900/10 bg-[#fbfaf7] p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-lime-700/70">Users</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-emerald-950 sm:text-4xl">User management</h1>
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-lime-700/10 bg-lime-100 text-lime-900">
              <UserRound className="h-5 w-5" />
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <article className="rounded-2xl border border-emerald-900/10 bg-white p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-lime-700/60">Total users</p>
            <p className="mt-3 text-2xl font-semibold text-emerald-950">{users.length}</p>
          </article>

          <article className="rounded-2xl border border-emerald-900/10 bg-white p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-lime-700/60">Visible users</p>
            <p className="mt-3 text-2xl font-semibold text-emerald-950">{visibleUsers.length}</p>
          </article>

          <article className="rounded-2xl border border-emerald-900/10 bg-white p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-lime-700/60">Active filter</p>
            <p className="mt-3 text-2xl font-semibold text-emerald-950 capitalize">{filterValue}</p>
          </article>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      )}

      <section className="rounded-[1.5rem] border border-emerald-900/10 bg-[#fbfaf7] p-5 shadow-sm shadow-emerald-950/5 sm:p-6">
        <div className="flex flex-col gap-2 border-b border-emerald-900/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-lime-700/70">Password requests</p>
          </div>
          <span className="text-xs uppercase tracking-[0.2em] text-emerald-900/50">{passwordRequests.length} pending</span>
        </div>

        {passwordRequests.length === 0 ? (
          <p className="pt-5 text-sm text-emerald-900/55">No pending password change requests.</p>
        ) : (
          <div className="grid gap-3 pt-5">
            {passwordRequests.map((request) => (
              <div key={request.id} className="flex flex-col gap-3 rounded-2xl border border-emerald-900/10 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-emerald-950">{request.email}</p>
                  <p className="mt-1 text-xs text-emerald-900/55">Requested {formatDate(request.requestedAt)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPasswordRequest(request);
                    setNewPassword('');
                    setError('');
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-900"
                >
                  <KeyRound className="h-4 w-4" />
                  Set new password
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <Table
        title="Users"

        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder="Search name, email, role, or status"
        filterValue={filterValue}
        onFilterChange={setFilterValue}
        filterOptions={filterOptions}
        actions={
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-950 px-4 py-3 text-sm font-medium text-white shadow-sm shadow-emerald-950/10 transition hover:bg-emerald-900"
          >
            <Plus className="h-4 w-4" />
            Create user
          </button>
        }
        columns={columns}
        data={visibleUsers}
        loading={loading}
        emptyState="No users match the current search or filter."
      />

      <ConfirmModal
        open={confirmState.open}
        title={confirmState.action === 'restore' ? 'Restore this user?' : 'Archive this user?'}
        description={
          confirmState.action === 'restore'
            ? 'This will set the account back to active and make it available again in the active user list.'
            : 'This will mark the account inactive and move it out of the active user list.'
        }
        confirmLabel={confirmState.action === 'restore' ? 'Restore user' : 'Archive user'}
        confirmIcon={confirmState.action === 'restore' ? RefreshCcw : Trash2}
        intent={confirmState.action === 'restore' ? 'success' : 'danger'}
        loading={Boolean(mutatingId)}
        onConfirm={handleConfirmAction}
        onCancel={closeConfirmModal}
      />

      {selectedPasswordRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-950/45 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[1.75rem] border border-emerald-900/10 bg-[#fbfaf7] p-5 shadow-2xl shadow-emerald-950/25 sm:p-6">
            <div className="flex items-start justify-between gap-4 border-b border-emerald-900/10 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-lime-700/70">Password request</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-emerald-950">Set a new password</h2>
                <p className="mt-2 text-sm text-emerald-900/60">{selectedPasswordRequest.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPasswordRequest(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-900/10 bg-white text-emerald-900/65 transition hover:bg-emerald-50 hover:text-emerald-950"
                aria-label="Close password request"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="mt-5 grid gap-4" onSubmit={handleResolvePasswordRequest}>
              <label className="grid gap-2">
                <span className="text-xs uppercase tracking-[0.28em] text-emerald-900/45">New password</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  minLength={6}
                  required
                  autoFocus
                  className="rounded-2xl border border-emerald-900/10 bg-white px-4 py-3 text-sm text-emerald-950 outline-none transition focus:border-lime-700/25"
                />
              </label>
              <div className="flex justify-end gap-3 border-t border-emerald-900/10 pt-4">
                <button
                  type="button"
                  onClick={() => setSelectedPasswordRequest(null)}
                  className="rounded-2xl border border-emerald-900/10 bg-white px-4 py-3 text-sm font-medium text-emerald-900/70 transition hover:bg-emerald-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resolvingPasswordRequest}
                  className="rounded-2xl bg-emerald-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resolvingPasswordRequest ? 'Updating...' : 'Update password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-950/45 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[1.75rem] border border-emerald-900/10 bg-[#fbfaf7] p-5 shadow-2xl shadow-emerald-950/25 sm:p-6">
            <div className="flex items-start justify-between gap-4 border-b border-emerald-900/10 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-lime-700/70">
                  {mode === 'create' ? 'Create user' : 'Edit user'}
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-emerald-950">
                  {mode === 'create' ? 'Add a new account' : 'Update account details'}
                </h2>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-900/10 bg-white text-emerald-900/65 transition hover:bg-emerald-50 hover:text-emerald-950"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="mt-5 grid gap-4" onSubmit={handleSaveUser}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.28em] text-emerald-900/45">First name</span>
                  <input
                    value={formData.first_name}
                    onChange={handleInputChange('first_name')}
                    className="rounded-2xl border border-emerald-900/10 bg-white px-4 py-3 text-sm text-emerald-950 outline-none transition placeholder:text-emerald-900/35 focus:border-lime-700/25"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.28em] text-emerald-900/45">Middle name</span>
                  <input
                    value={formData.middle_name}
                    onChange={handleInputChange('middle_name')}
                    className="rounded-2xl border border-emerald-900/10 bg-white px-4 py-3 text-sm text-emerald-950 outline-none transition placeholder:text-emerald-900/35 focus:border-lime-700/25"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.28em] text-emerald-900/45">Last name</span>
                  <input
                    value={formData.last_name}
                    onChange={handleInputChange('last_name')}
                    className="rounded-2xl border border-emerald-900/10 bg-white px-4 py-3 text-sm text-emerald-950 outline-none transition placeholder:text-emerald-900/35 focus:border-lime-700/25"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.28em] text-emerald-900/45">Suffix</span>
                  <input
                    value={formData.suffix}
                    onChange={handleInputChange('suffix')}
                    className="rounded-2xl border border-emerald-900/10 bg-white px-4 py-3 text-sm text-emerald-950 outline-none transition placeholder:text-emerald-900/35 focus:border-lime-700/25"
                  />
                </label>

                <label className="grid gap-2 sm:col-span-2">
                  <span className="text-xs uppercase tracking-[0.28em] text-emerald-900/45">Email</span>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={handleInputChange('email')}
                    readOnly={mode === 'create'}
                    className={`rounded-2xl border border-emerald-900/10 bg-white px-4 py-3 text-sm text-emerald-950 outline-none transition placeholder:text-emerald-900/35 focus:border-lime-700/25 ${
                      mode === 'create' ? 'bg-emerald-50/70' : ''
                    }`}
                  />
                  {mode === 'create' && (
                    <span className="text-xs text-emerald-900/45">
                      Auto-generated from the first initial and last name.
                    </span>
                  )}
                </label>

                {mode === 'create' ? (
                  <label className="grid gap-2 sm:col-span-2">
                    <span className="text-xs uppercase tracking-[0.28em] text-emerald-900/45">Password</span>
                    <input
                      type="text"
                      value={formData.password}
                      onChange={handleInputChange('password')}
                      readOnly
                      className="rounded-2xl border border-emerald-900/10 bg-emerald-50/70 px-4 py-3 font-mono text-sm text-emerald-950 outline-none transition placeholder:text-emerald-900/35 focus:border-lime-700/25"
                    />
                    <span className="text-xs text-emerald-900/45">
                      Auto-generated from the first initial and last name.
                    </span>
                  </label>
                ) : (
                  <label className="grid gap-2 sm:col-span-2">
                    <span className="text-xs uppercase tracking-[0.28em] text-emerald-900/45">Role</span>
                    <select
                      value={formData.role}
                      onChange={handleInputChange('role')}
                      className="rounded-2xl border border-emerald-900/10 bg-white px-4 py-3 text-sm text-emerald-950 outline-none transition focus:border-lime-700/25"
                    >
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-emerald-900/10 pt-4 sm:flex-row sm:items-center sm:justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="inline-flex items-center justify-center rounded-2xl border border-emerald-900/10 bg-white px-5 py-3 text-sm font-medium text-emerald-900/70 transition hover:bg-emerald-50 hover:text-emerald-950"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving...' : 'Save user'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}