import {
  type ActionFunctionArgs,
  unstable_composeUploadHandlers as composeUploadHandlers,
  unstable_createFileUploadHandler as createFileUploadHandler,
  unstable_createMemoryUploadHandler as createMemoryUploadHandler,
  json,
  type LoaderFunctionArgs,
  unstable_parseMultipartFormData as parseMultipartFormData,
  redirect,
} from '@remix-run/node';
import {
  generatePath,
  Link,
  Form as RemixForm,
  useActionData,
  useLoaderData,
  useSearchParams,
} from '@remix-run/react';
import dayjs from 'dayjs';
import { useState } from 'react';
import { match } from 'ts-pattern';

import {
  getResumeBook,
  getResumeBookSubmission,
  listResumeBookSponsors,
  submitResume,
} from '@oyster/core/resume-books';
import {
  RESUME_BOOK_CODING_LANGUAGES,
  RESUME_BOOK_JOB_SEARCH_STATUSES,
  RESUME_BOOK_ROLES,
  SubmitResumeInput,
} from '@oyster/core/resume-books.types';
import { db } from '@oyster/db';
import { FORMATTED_RACE, Race, WorkAuthorizationStatus } from '@oyster/types';
import {
  Button,
  Checkbox,
  Divider,
  Form,
  getErrors,
  Input,
  Radio,
  Select,
  Text,
  validateForm,
} from '@oyster/ui';
import { iife } from '@oyster/utils';

import { type DegreeType, FORMATTED_DEGREEE_TYPE } from '@/member-profile.ui';
import { HometownField } from '@/shared/components/profile.personal';
import { Route } from '@/shared/constants';
import { getTimezone } from '@/shared/cookies.server';
import { getMember } from '@/shared/queries';
import {
  commitSession,
  ensureUserAuthenticated,
  toast,
  user,
} from '@/shared/session.server';

export async function loader({ params, request }: LoaderFunctionArgs) {
  const session = await ensureUserAuthenticated(request);

  const id = params.id as string;
  const memberId = user(session);

  const [member, _resumeBook, submission, sponsors, _educations] =
    await Promise.all([
      getMember(memberId)
        .select([
          'email',
          'firstName',
          'hometown',
          'hometownCoordinates',
          'lastName',
          'linkedInUrl',
          'race',
          'workAuthorizationStatus',
        ])
        .executeTakeFirst(),

      getResumeBook({
        select: ['endDate', 'id', 'name', 'startDate'],
        where: { id },
      }),

      getResumeBookSubmission({
        select: [
          'codingLanguages',
          'educationId',
          'employmentSearchStatus',
          'preferredCompany1',
          'preferredCompany2',
          'preferredCompany3',
          'preferredRoles',
        ],
        where: { memberId, resumeBookId: id },
      }),

      listResumeBookSponsors({
        where: { resumeBookId: id },
      }),

      await db
        .selectFrom('educations')
        .leftJoin('schools', 'schools.id', 'educations.schoolId')
        .select([
          'educations.degreeType',
          'educations.endDate',
          'educations.id',
          'educations.startDate',
          'schools.name as schoolName',
        ])
        .where('studentId', '=', memberId)
        .orderBy('endDate', 'desc')
        .orderBy('startDate', 'desc')
        .execute(),
    ]);

  if (!member) {
    throw new Response(null, { status: 500 });
  }

  if (!_resumeBook) {
    throw new Response(null, { status: 404 });
  }

  const timezone = getTimezone(request);

  const resumeBook = {
    ..._resumeBook,

    endDate: dayjs(_resumeBook.endDate)
      .tz(timezone)
      .format('dddd, MMMM DD, YYYY @ h:mm A'),

    startDate: dayjs(_resumeBook.startDate)
      .tz(timezone)
      .format('dddd, MMMM DD, YYYY @ h:mm A'),

    status: iife(() => {
      const now = dayjs();

      if (now.isBefore(_resumeBook.startDate)) {
        return 'upcoming' as const;
      }

      if (now.isAfter(_resumeBook.endDate)) {
        return 'past' as const;
      }

      return 'active' as const;
    }),
  };

  const educations = _educations.map(({ endDate, startDate, ...education }) => {
    return {
      ...education,
      date:
        dayjs.utc(startDate).format('MMMM YYYY') +
        ' - ' +
        dayjs.utc(endDate).format('MMMM YYYY'),
    };
  });

  return json({
    educations,
    member,
    resumeBook,
    sponsors,
    submission,
  });
}

export async function action({ params, request }: ActionFunctionArgs) {
  const session = await ensureUserAuthenticated(request);

  const uploadHandler = composeUploadHandlers(
    createFileUploadHandler({ maxPartSize: 1_000_000 * 1 }),
    createMemoryUploadHandler()
  );

  let form: FormData;

  try {
    form = await parseMultipartFormData(request, uploadHandler);
  } catch (e) {
    return json(
      {
        errors: {
          resume: 'Attachment is too big. Must be less than 1 MB in size.',
        } as Record<keyof SubmitResumeInput, string>,
      },
      {
        status: 400,
      }
    );
  }

  const resumeBookId = params.id as string;

  form.set('memberId', user(session));
  form.set('resumeBookId', resumeBookId);

  const resume = form.get('resume') as File;

  const { data, errors, ok } = await validateForm(
    {
      ...Object.fromEntries(form),
      codingLanguages: form.getAll('codingLanguages'),
      preferredRoles: form.getAll('preferredRoles'),
      race: form.getAll('race'),
      resume: resume.size ? resume : null,
    },
    SubmitResumeInput
  );

  if (!ok) {
    return json({ errors }, { status: 400 });
  }

  await submitResume({
    codingLanguages: data.codingLanguages,
    educationId: data.educationId,
    employmentSearchStatus: data.employmentSearchStatus,
    firstName: data.firstName,
    lastName: data.lastName,
    hometown: data.hometown,
    hometownLatitude: data.hometownLatitude,
    hometownLongitude: data.hometownLongitude,
    linkedInUrl: data.linkedInUrl,
    memberId: data.memberId,
    preferredCompany1: data.preferredCompany1,
    preferredCompany2: data.preferredCompany2,
    preferredCompany3: data.preferredCompany3,
    preferredRoles: data.preferredRoles,
    race: data.race,
    resume: data.resume,
    resumeBookId: data.resumeBookId,
    workAuthorizationStatus: data.workAuthorizationStatus,
  });

  toast(session, {
    message: 'Resume submitted!',
    type: 'success',
  });

  return redirect(
    generatePath(Route['/resume-books/:id'], { id: resumeBookId }),
    {
      headers: {
        'Set-Cookie': await commitSession(session),
      },
    }
  );
}

const keys = SubmitResumeInput.keyof().enum;

export default function ResumeBook() {
  const { resumeBook, submission } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const showEditButton =
    !!submission && searchParams.get('state') !== 'editing';

  return (
    <section className="mx-auto flex w-full max-w-[36rem] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Text variant="2xl">Resume Book: {resumeBook.name}</Text>

        {match(resumeBook.status)
          .with('active', () => {
            if (showEditButton) {
              return null;
            }

            return (
              <Text color="gray-500">
                Before continuining, please ensure that your{' '}
                <Link
                  className="link"
                  target="_blank"
                  to={Route['/profile/emails']}
                >
                  primary email
                </Link>{' '}
                and{' '}
                <Link
                  className="link"
                  target="_blank"
                  to={Route['/profile/education']}
                >
                  education history
                </Link>{' '}
                is up to date.
              </Text>
            );
          })
          .with('past', () => {
            return (
              <Text color="gray-500">
                This resume book closed on {resumeBook.endDate}.
              </Text>
            );
          })
          .with('upcoming', () => {
            return (
              <Text color="gray-500">
                This resume book opens on {resumeBook.startDate}.
              </Text>
            );
          })
          .exhaustive()}
      </div>

      {resumeBook.status === 'active' &&
        (showEditButton ? (
          <div className="flex flex-col gap-8 rounded-xl border border-dashed border-green-700 bg-green-50 p-4">
            <Text>
              Thank you for submitting your resume to the {resumeBook.name}{' '}
              resume book! You can edit your submission until the deadline:{' '}
              {resumeBook.endDate}.
            </Text>

            <button
              className="link w-fit"
              onClick={() => {
                setSearchParams((searchParams) => {
                  searchParams.set('state', 'editing');

                  return searchParams;
                });
              }}
              type="button"
            >
              Edit Submission
            </button>
          </div>
        ) : (
          <ResumeBookForm />
        ))}
    </section>
  );
}

function ResumeBookForm() {
  const { educations, member, submission } = useLoaderData<typeof loader>();
  const { error, errors } = getErrors(useActionData<typeof action>());

  return (
    <RemixForm
      className="form mt-4"
      data-gap="2rem"
      method="post"
      encType="multipart/form-data"
    >
      <Form.Field
        error={errors.firstName}
        label="First Name"
        labelFor={keys.firstName}
        required
      >
        <Input
          defaultValue={member.firstName}
          id={keys.firstName}
          name={keys.firstName}
          required
        />
      </Form.Field>

      <Form.Field
        error={errors.lastName}
        label="Last Name"
        labelFor={keys.lastName}
        required
      >
        <Input
          defaultValue={member.lastName}
          id={keys.lastName}
          name={keys.lastName}
          required
        />
      </Form.Field>

      <Form.Field
        description={
          <Text>
            If you would like to change your primary email, click{' '}
            <Link
              className="link"
              target="_blank"
              to={Route['/profile/emails']}
            >
              here
            </Link>
            .
          </Text>
        }
        label="Email"
        labelFor="email"
        required
      >
        <Input
          defaultValue={member.email}
          disabled
          id="email"
          name="email"
          required
        />
      </Form.Field>

      <Form.Field
        description="How do you identify?"
        error={errors.race}
        label="Race & Ethnicity"
        labelFor={keys.race}
        required
      >
        <Checkbox.Group>
          {[
            Race.BLACK,
            Race.HISPANIC,
            Race.NATIVE_AMERICAN,
            Race.MIDDLE_EASTERN,
            Race.WHITE,
            Race.ASIAN,
            Race.OTHER,
          ].map((value) => {
            return (
              <Checkbox
                key={value}
                defaultChecked={member.race.includes(value)}
                id={keys.race + value}
                label={FORMATTED_RACE[value]}
                name={keys.race}
                value={value}
              />
            );
          })}
        </Checkbox.Group>
      </Form.Field>

      <Form.Field
        error={error}
        label="LinkedIn Profile/URL"
        labelFor={keys.linkedInUrl}
        required
      >
        <Input
          defaultValue={member.linkedInUrl || undefined}
          id={keys.linkedInUrl}
          name={keys.linkedInUrl}
          required
        />
      </Form.Field>

      <Form.Field
        description="For reference, US and Canadian citizens are always authorized, while non-US citizens may be authorized if their immigration status allows them to work."
        error={errors.workAuthorizationStatus}
        label="Are you authorized to work in the US or Canada?"
        labelFor={keys.workAuthorizationStatus}
        required
      >
        <Select
          defaultValue={member.workAuthorizationStatus || undefined}
          id={keys.workAuthorizationStatus}
          name={keys.workAuthorizationStatus}
          required
        >
          <option value={WorkAuthorizationStatus.AUTHORIZED}>Yes</option>
          <option value={WorkAuthorizationStatus.NEEDS_SPONSORSHIP}>
            Yes, with visa sponsorship
          </option>
          <option value={WorkAuthorizationStatus.UNAUTHORIZED}>No</option>
          <option value={WorkAuthorizationStatus.UNSURE}>I'm not sure</option>
        </Select>
      </Form.Field>

      <HometownField
        defaultLatitude={member.hometownCoordinates?.y}
        defaultLongitude={member.hometownCoordinates?.x}
        defaultValue={member.hometown || undefined}
        description="Where did you grow up/attend high school?"
        error={errors.hometown}
        latitudeName={keys.hometownLatitude}
        longitudeName={keys.hometownLongitude}
        name={keys.hometown}
      />

      <Form.Field
        description="Companies will use this to determine your graduation date, education level, and university location so be sure it's updated."
        error={errors.educationId}
        label="Select your highest level of education."
        labelFor={keys.educationId}
        required
      >
        <Select
          defaultValue={submission?.educationId}
          id={keys.educationId}
          name={keys.educationId}
          required
        >
          {educations.map((education) => {
            return (
              <option key={education.id} value={education.id}>
                {education.schoolName},{' '}
                {FORMATTED_DEGREEE_TYPE[education.degreeType as DegreeType]},{' '}
                {education.date}
              </option>
            );
          })}
        </Select>
      </Form.Field>

      <Divider />

      <Form.Field
        error={errors.codingLanguages}
        label="Which coding language(s) are you most proficient with?"
        labelFor={keys.codingLanguages}
        required
      >
        <Checkbox.Group>
          {RESUME_BOOK_CODING_LANGUAGES.map((value) => {
            return (
              <Checkbox
                key={value}
                defaultChecked={submission?.codingLanguages.includes(value)}
                id={keys.codingLanguages + value}
                label={value}
                name={keys.codingLanguages}
                value={value}
              />
            );
          })}
        </Checkbox.Group>
      </Form.Field>

      <Form.Field
        error={errors.preferredRoles}
        label="Which kind of roles are you interested in?"
        labelFor={keys.preferredRoles}
        required
      >
        <Checkbox.Group>
          {RESUME_BOOK_ROLES.map((value) => {
            return (
              <Checkbox
                key={value}
                defaultChecked={submission?.preferredRoles.includes(value)}
                id={keys.preferredRoles + value}
                label={value}
                name={keys.preferredRoles}
                value={value}
              />
            );
          })}
        </Checkbox.Group>
      </Form.Field>

      <Form.Field
        error={errors.employmentSearchStatus}
        label="Which is the status of your employment search?"
        labelFor={keys.employmentSearchStatus}
        required
      >
        <Radio.Group>
          {RESUME_BOOK_JOB_SEARCH_STATUSES.map((value) => {
            return (
              <Radio
                key={value}
                defaultChecked={submission?.employmentSearchStatus === value}
                id={keys.employmentSearchStatus + value}
                label={value}
                name={keys.employmentSearchStatus}
                required
                value={value}
              />
            );
          })}
        </Radio.Group>
      </Form.Field>

      <PreferredSponsorsField />

      <Form.Field
        description={
          !submission
            ? 'Must be a PDF less than 1 MB.'
            : 'Must be a PDF less than 1 MB. If you do not choose a new resume to resubmit, we will use the resume you currently have on file.'
        }
        error={errors.resume}
        label="Resume"
        labelFor="resume"
        required={!submission}
      >
        <input
          accept=".pdf"
          id="resume"
          name="resume"
          required={!submission}
          type="file"
        />
      </Form.Field>

      <Form.ErrorMessage>{error}</Form.ErrorMessage>

      <Button.Group>
        <Button.Submit>Submit</Button.Submit>
      </Button.Group>
    </RemixForm>
  );
}

function PreferredSponsorsField() {
  const { sponsors, submission } = useLoaderData<typeof loader>();
  const { errors } = getErrors(useActionData<typeof action>());

  const [selectedCompanies, setSelectedCompanies] = useState({
    1: submission?.preferredCompany1 || '',
    2: submission?.preferredCompany2 || '',
    3: submission?.preferredCompany3 || '',
  });

  function chooseCompany(e: React.FormEvent<HTMLSelectElement>, rank: number) {
    const value = e.currentTarget.value;

    // If the company that we're selecting is already selected in a
    // different option, we'll clear that option forcing the user
    // to pick a different company.
    const duplicateCompanies = Object.keys(selectedCompanies)
      .filter((key) => {
        const alreadySelected =
          selectedCompanies[key as unknown as 1 | 2 | 3] === value;

        return key !== rank.toString() && alreadySelected;
      })
      .map((key) => {
        return [key, ''];
      });

    setSelectedCompanies((companies) => {
      return {
        ...companies,
        ...Object.fromEntries(duplicateCompanies),
        [rank]: value,
      };
    });
  }

  const options = (
    <>
      {sponsors.map((sponsor) => {
        return (
          <option key={sponsor.id} value={sponsor.id as string}>
            {sponsor.name}
          </option>
        );
      })}
    </>
  );

  return (
    <Form.Field
      error={
        errors.preferredCompany1 ||
        errors.preferredCompany2 ||
        errors.preferredCompany3
      }
      label="Of all the ColorStack sponsors, which are you most interested in working for?"
      labelFor={keys.preferredCompany1}
      required
    >
      <div className="flex flex-col gap-2">
        <Select
          id={keys.preferredCompany1}
          name={keys.preferredCompany1}
          onChange={(e) => {
            chooseCompany(e, 1);
          }}
          placeholder="Choose your #1 company..."
          required
          value={selectedCompanies[1]}
        >
          {options}
        </Select>

        <Select
          id={keys.preferredCompany2}
          name={keys.preferredCompany2}
          onChange={(e) => {
            chooseCompany(e, 2);
          }}
          placeholder="Choose your #2 company..."
          required
          value={selectedCompanies[2]}
        >
          {options}
        </Select>

        <Select
          id={keys.preferredCompany3}
          name={keys.preferredCompany3}
          onChange={(e) => {
            chooseCompany(e, 3);
          }}
          placeholder="Choose your #3 company..."
          required
          value={selectedCompanies[3]}
        >
          {options}
        </Select>
      </div>
    </Form.Field>
  );
}
