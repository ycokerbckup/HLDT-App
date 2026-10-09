-- (Applied to production on 2026-10-09.) Celebration notifications now go out at 8:00 Lagos time
-- (07:00 UTC). They previously ran at 06:00 UTC = 7:00. The job's command is unchanged.
select cron.alter_job((select jobid from cron.job where jobname = 'daily-celebrations'), schedule => '0 7 * * *');
