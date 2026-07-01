// Pathways graph: connects Subject <-> Qualification <-> Course <-> University <-> Career
// so the product is no longer "student -> single job" but a navigable map of
// education + career routes. Every lookup here is deterministic and reads
// straight from the JSON data files -- no LLM touches this layer, same rule
// as lib/scoring.js and lib/lifeSimulator.js.

const fs = require("fs");
const path = require("path");

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", file), "utf-8"));
}

const SUBJECTS = loadJson("subjects.json");
const QUALIFICATIONS = loadJson("qualifications.json");
const COURSES = loadJson("courses.json");
const UNIVERSITIES = loadJson("universities.json");
const CAREERS = loadJson("careers.json");

const bySubjectId = new Map(SUBJECTS.map((s) => [s.id, s]));
const byCourseId = new Map(COURSES.map((c) => [c.id, c]));
const byQualId = new Map(QUALIFICATIONS.map((q) => [q.id, q]));
const byCareerId = new Map(CAREERS.map((c) => [c.id, c]));

function getSubject(id) {
  return bySubjectId.get(id) || null;
}
function getCourse(id) {
  return byCourseId.get(id) || null;
}
function getQualification(id) {
  return byQualId.get(id) || null;
}
function getCareer(id) {
  return byCareerId.get(id) || null;
}

function universitiesOfferingCourse(courseId) {
  const rows = [];
  UNIVERSITIES.forEach((u) => {
    const offering = u.offerings.find((o) => o.courseId === courseId);
    if (offering) rows.push({ universityId: u.id, universityName: u.name, locationId: u.locationId, overallRanking: u.overallRanking, ...offering });
  });
  return rows.sort((a, b) => (a.overallRanking || 999) - (b.overallRanking || 999));
}

function coursesForSubject(subjectId) {
  const subject = getSubject(subjectId);
  if (!subject) return [];
  return (subject.unlocksCourseIds || []).map(getCourse).filter(Boolean);
}

function careersForCourse(courseId) {
  const course = getCourse(courseId);
  if (!course) return [];
  return (course.careerIds || []).map(getCareer).filter(Boolean);
}

// Full graph expansion from a single subject: Subject -> Courses -> Careers,
// so a student can see "what does this subject open up" at a glance.
function exploreFromSubject(subjectId) {
  const subject = getSubject(subjectId);
  if (!subject) return null;
  const courses = coursesForSubject(subjectId).map((course) => ({
    ...course,
    careers: careersForCourse(course.id).map((c) => ({ id: c.id, title: c.title, earningsRange: c.earningsRange, outlook: c.outlook })),
    universities: universitiesOfferingCourse(course.id).slice(0, 3),
  }));
  return { subject, courses };
}

// Full graph expansion from a single course: required subjects, careers it
// leads to, alternative courses, and which universities offer it.
function exploreFromCourse(courseId) {
  const course = getCourse(courseId);
  if (!course) return null;
  const requiredSubjects = (course.requiredSubjectIds || []).map(getSubject).filter(Boolean);
  const altSubjects = (course.altSubjectIds || []).map(getSubject).filter(Boolean);
  const careers = careersForCourse(courseId);
  const alternativeCourses = (course.alternativeCourseIds || []).map(getCourse).filter(Boolean);
  const universities = universitiesOfferingCourse(courseId);
  return { course, requiredSubjects, altSubjects, careers, alternativeCourses, universities };
}

// Builds a connected, multi-stage roadmap for a scored career path:
// Subject(s) -> Qualification ladder -> Course -> University option -> Career -> Specialisation.
// This replaces the old flat 5-point "career only" roadmap with real graph nodes
// pulled from the new data files, while staying backward compatible in shape
// (each node still has {age, milestone}, plus new optional {type, refId, detail} fields).
function buildConnectedRoadmap(profile, scoredPath, startAge) {
  const career = getCareer(scoredPath.id);
  if (!career) return null;

  const subjectIds = career.subjectIds || [];
  const courseId = (career.courseIds || [])[0] || null;
  const course = courseId ? getCourse(courseId) : null;
  const unis = courseId ? universitiesOfferingCourse(courseId).slice(0, 2) : [];

  const nodes = [];

  nodes.push({
    age: startAge,
    type: "subject",
    milestone: `Choose subjects: ${scoredPath.requiredSubjects.join(", ")}${scoredPath.altSubjects?.length ? ` (or ${scoredPath.altSubjects.join("/")})` : ""}`,
    refIds: subjectIds,
  });

  nodes.push({
    age: startAge + 2,
    type: "qualification",
    milestone: course
      ? `A-Levels / BTEC / T Level chosen to meet entry requirements for ${course.title}`
      : `Next qualification stage aligned to ${scoredPath.title}`,
    refIds: ["a-level", "btec", "t-level"],
  });

  if (course) {
    const uniNote = unis.length
      ? ` -- e.g. ${unis.map((u) => `${u.universityName} (${u.typicalGrades})`).join(" or ")}`
      : "";
    nodes.push({
      age: startAge + 3,
      type: "course",
      milestone: `Degree: ${course.title} (${course.durationYears} yrs)${uniNote}`,
      refIds: [course.id],
    });
  } else {
    nodes.push({
      age: startAge + 3,
      type: "university-route",
      milestone: `University/route: ${scoredPath.universityRoutes[0]}`,
      refIds: [],
    });
  }

  nodes.push({
    age: startAge + (course ? course.durationYears + 3 : 6),
    type: "career",
    milestone: `First role or placement in or adjacent to ${scoredPath.title}`,
    refIds: [scoredPath.id],
  });

  nodes.push({
    age: startAge + (course ? course.durationYears + 7 : 10),
    type: "specialisation",
    milestone: `Established in ${scoredPath.title} -- indicative earnings ${scoredPath.earningsRange}`,
    refIds: [scoredPath.id],
  });

  return nodes;
}

// Generic side-by-side comparison across courses, careers, or universities --
// powers the "Compare" feature without needing bespoke code per entity type.
function compare(type, ids) {
  if (type === "course") {
    return ids.map(getCourse).filter(Boolean).map((c) => ({
      id: c.id,
      title: c.title,
      avgSalaryGraduate: c.avgSalaryGraduate,
      demand: c.demand,
      difficulty: c.difficulty,
      durationYears: c.durationYears,
      careerIds: c.careerIds,
    }));
  }
  if (type === "career") {
    return ids.map(getCareer).filter(Boolean).map((c) => ({
      id: c.id,
      title: c.title,
      earningsRange: c.earningsRange,
      growthScore: c.growthScore,
      riskScore: c.riskScore,
      outlook: c.outlook,
    }));
  }
  if (type === "university") {
    return ids
      .map((id) => UNIVERSITIES.find((u) => u.id === id))
      .filter(Boolean)
      .map((u) => ({ id: u.id, name: u.name, overallRanking: u.overallRanking, offerings: u.offerings }));
  }
  return [];
}

module.exports = {
  SUBJECTS,
  QUALIFICATIONS,
  COURSES,
  UNIVERSITIES,
  getSubject,
  getCourse,
  getQualification,
  getCareer,
  universitiesOfferingCourse,
  coursesForSubject,
  careersForCourse,
  exploreFromSubject,
  exploreFromCourse,
  buildConnectedRoadmap,
  compare,
};
