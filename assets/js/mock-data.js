(function () {
  const day = 24 * 60 * 60 * 1000;
  const ago = (days, hours) => new Date(Date.now() - days * day - (hours || 0) * 60 * 60 * 1000).toISOString();
  const demoStudentId = "student-demo";
  const demoStudentName = "Demo Student";
  const complaint = (id, title, category, location, priority, description, status, days, ownerId, ownerName, remark) => {
    const createdAt = ago(days);
    const history = [{ status: "Pending", at: createdAt, note: "Complaint submitted" }];
    if (status === "In Progress" || status === "Resolved") {
      history.push({ status: "In Progress", at: ago(Math.max(0, days - 1), 2), note: "The campus team started reviewing this complaint" });
    }
    if (status === "Resolved") {
      history.push({ status: "Resolved", at: ago(Math.max(0, days - 2), 1), note: "The campus team marked this issue as resolved" });
    }
    return {
      id,
      title,
      category,
      location,
      priority,
      description,
      status,
      createdAt,
      updatedAt: history[history.length - 1].at,
      ownerId,
      ownerName,
      ownerEmail: ownerId === demoStudentId ? "student@example.invalid" : "riya@example.invalid",
      imageData: "",
      imageName: "",
      adminRemark: remark || "",
      history
    };
  };
  const seedComplaints = [
    complaint("CC-2601", "Wi-Fi disconnects in the library", "IT & Wi-Fi", "Central Library", "High", "The campus Wi-Fi disconnects every few minutes on the second floor. It is difficult to access lecture material and submit assignments.", "In Progress", 2, demoStudentId, demoStudentName, "Our IT team is checking the access point on the second floor."),
    complaint("CC-2602", "Water cooler needs repair", "Facilities", "Main Block", "Medium", "The water cooler beside room 204 is not dispensing cold water.", "Pending", 1, demoStudentId, demoStudentName, ""),
    complaint("CC-2603", "Broken light near the east entrance", "Facilities", "Hostel", "High", "The pathway light near the east hostel entrance has not been working for several nights.", "Resolved", 6, "student-riya", "Riya Patel", "The electrical team replaced the lamp and checked the surrounding fixtures."),
    complaint("CC-2604", "Projector image is out of focus", "Academics", "Engineering Lab", "Low", "The projector in Lab 3 is blurry even after adjusting the focus.", "Pending", 4, "student-riya", "Riya Patel", ""),
    complaint("CC-2605", "Cafeteria tables need cleaning", "Cleanliness", "Cafeteria", "Medium", "Several tables in the east dining area were left uncleaned during lunch.", "In Progress", 3, "student-riya", "Riya Patel", "The housekeeping supervisor has been notified and is reviewing the cleaning schedule."),
    complaint("CC-2606", "Request for quieter study hours", "Other", "Central Library", "Low", "Please consider quiet study hours in the reading room during exam weeks.", "Resolved", 9, demoStudentId, demoStudentName, "Quiet study hours have been added to the library schedule for the exam period.")
  ];

  window.CampusCareMock = {
    complaintsKey: "campuscare_complaints_v1",
    seedComplaints,
    categories: ["Facilities", "IT & Wi-Fi", "Academics", "Cleanliness", "Safety", "Other"],
    locations: ["Central Library", "Main Block", "Hostel", "Cafeteria", "Engineering Lab", "Sports Complex", "Other"],
    priorities: ["Low", "Medium", "High"],
    statuses: ["Pending", "In Progress", "Resolved"],
    initialize: function () {
      localStorage.removeItem("campuscare_users_v1");
      localStorage.removeItem("campuscare_session_v1");
      if (!localStorage.getItem(this.complaintsKey)) {
        localStorage.setItem(this.complaintsKey, JSON.stringify(this.seedComplaints));
      }
    }
  };
}());
