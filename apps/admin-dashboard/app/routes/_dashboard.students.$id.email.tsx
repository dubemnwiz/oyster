import {
  ActionFunctionArgs,
  json,
  LoaderFunctionArgs,
  redirect,
} from '@remix-run/node';
import {
  Form as RemixForm,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
} from '@remix-run/react';
import { z } from 'zod';

import {
  Button,
  Form,
  getActionErrors,
  Input,
  Modal,
  validateForm,
} from '@colorstack/core-ui';
import { Student } from '@colorstack/types';

import { Route } from '../shared/constants';
import { db, updateMemberEmail } from '../shared/core.server';
import {
  commitSession,
  ensureUserAuthenticated,
  toast,
} from '../shared/session.server';

export async function loader({ params, request }: LoaderFunctionArgs) {
  await ensureUserAuthenticated(request);

  const student = await db
    .selectFrom('students')
    .select(['firstName', 'lastName'])
    .where('id', '=', params.id as string)
    .executeTakeFirst();

  if (!student) {
    throw new Response(null, { status: 404 });
  }

  return json({
    student,
  });
}

const UpdateStudentEmailInput = Student.pick({
  email: true,
});

type UpdateStudentEmailInput = z.infer<typeof UpdateStudentEmailInput>;

export async function action({ params, request }: ActionFunctionArgs) {
  const session = await ensureUserAuthenticated(request);

  const form = await request.formData();

  const { data, errors } = validateForm(
    UpdateStudentEmailInput,
    Object.fromEntries(form)
  );

  if (!data) {
    return json({
      error: 'Please fix the errors above.',
      errors,
    });
  }

  const result = await updateMemberEmail({
    email: data.email,
    id: params.id as string,
  });

  if (result instanceof Error) {
    return json({
      error: result.message,
      errors,
    });
  }

  toast(session, {
    message: 'Updated member email.',
    type: 'success',
  });

  return redirect(Route.STUDENTS, {
    headers: {
      'Set-Cookie': await commitSession(session),
    },
  });
}

export default function UpdateStudentEmailPage() {
  const { student } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  function onClose() {
    navigate(Route.STUDENTS);
  }

  return (
    <Modal onClose={onClose}>
      <Modal.Header>
        <Modal.Title>
          Update Email - {student.firstName} {student.lastName}
        </Modal.Title>

        <Modal.CloseButton />
      </Modal.Header>

      <Modal.Description>
        Are you sure you want to update the email of this member? They will
        receive any email communications here going forward.
      </Modal.Description>

      <UpdateStudentEmailForm />
    </Modal>
  );
}

const { email } = UpdateStudentEmailInput.keyof().enum;

function UpdateStudentEmailForm() {
  const { error, errors } = getActionErrors(useActionData<typeof action>());

  const submitting = useNavigation().state === 'submitting';

  return (
    <RemixForm className="form" method="post">
      <Form.Field error={errors.email} label="Email" labelFor={email} required>
        <Input id={email} name={email} required />
      </Form.Field>

      <Form.ErrorMessage>{error}</Form.ErrorMessage>

      <Button.Group>
        <Button loading={submitting} type="submit">
          Update
        </Button>
      </Button.Group>
    </RemixForm>
  );
}